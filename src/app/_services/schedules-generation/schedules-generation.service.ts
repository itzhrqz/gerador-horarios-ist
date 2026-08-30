// tslint:disable:max-line-length

import {Injectable} from '@angular/core';

import {LoggerService} from '../../_util/logger.service';
import {StateService} from '../state/state.service';

import {Schedule} from '../../_domain/Schedule/Schedule';
import {Class} from '../../_domain/Class/Class';
import {Course} from '../../_domain/Course/Course';
import {Shift} from '../../_domain/Shift/Shift';
import {Lesson} from '../../_domain/Lesson/Lesson';
import {Event} from '../../_domain/Event/Event';

import {
  formatTime,
  getTimestamp,
  getWeekday
} from '../../_util/Time';

import {
  minifyClassType
} from '../../_domain/ClassType/ClassType';


@Injectable({
  providedIn: 'root'
})
export class SchedulesGenerationService {


  /* ==========================================================================
   * GENERATED SCHEDULE INFORMATION
   * ======================================================================== */

  generatedSchedulesInfo:
    Map<number, {
      proximity: number,
      nr_holes: number,
      total_duration: number,
      total_deviation: number,
      nr_free_days: number,
      events: Event[]
    }> =
      new Map<number, {
        proximity: number,
        nr_holes: number,
        total_duration: number,
        total_deviation: number,
        nr_free_days: number,
        events: Event[]
      }>();


  /* ==========================================================================
   * GENERATION CONSTANTS
   * ======================================================================== */

  /*
   * Don't exceed 500K.
   */
  private BATCH_SIZE = 500000;


  /*
   * Schedule IDs never restart between batches.
   */
  private nextScheduleId = 0;


  /* ==========================================================================
   * PERSISTENT GENERATION STATE
   * ======================================================================== */

  private genState:
    {
      classesPerCourse: Class[][];

      usingWorkers: boolean;

      workers: {
        index: number;
        firstClassStart: number;
        firstClassCount: number;
        worker: Worker;
        exhausted: boolean;
        initialized: boolean;
      }[];

      singleState: {
        current: Class[];
        indexes: number[];
        firstIndex: number;
        exhausted: boolean;
      } | null;

    } | null = null;


  /* ==========================================================================
   * PROGRESS CALLBACKS
   * ======================================================================== */

  updateBar: any =
    () => console.log('updateBar not defined');

  setBar: any =
    () => console.log('setBar not defined');


  constructor(
    public logger: LoggerService,
    private stateService: StateService
  ) {
    this.BATCH_SIZE = this.stateService.maxSchedulesInMemory;
  }


  setBarFunctions(
    updateBar: any,
    setBar: any
  ): void {

    
    this.updateBar = updateBar;
    this.setBar = setBar;
  }


  /* ==========================================================================
   * PUBLIC GENERATION API
   * ======================================================================== */

  async generateSchedules(
    courses: Course[]
  ): Promise<Schedule[]> {

    this.logger.log(
      'generating...'
    );


    /*
     * A new generation invalidates any previous workers.
     */
    this.destroyGenerationWorkers();


    await this.setBar(0);


    /*
     * Build valid Class[] choices.
     */
    const classesPerCourse =
      this.combineShiftsMain(courses);


    await this.setBar(10);


    /*
     * Create persistent generation state.
     */
    this.setupGenerationState(
      classesPerCourse
    );


    if (!this.genState) {

      await this.setBar(100);

      return [];
    }


    /*
     * Wait until every worker has actually processed
     * its initialization message.
     */
    if (this.genState.usingWorkers) {

      await this.waitForWorkersToInitialize();
    }


    this.logger.log(
      'combining classes...'
    );


    /*
     * Generate ONLY the first batch.
     *
     * The workers are NOT destroyed afterwards.
     */
    const combinations =
      await this.runBatch(
        this.BATCH_SIZE
      );


    await this.setBar(90);


    this.logger.log(
      'calculating info...'
    );


    let schedules =
      this.calculateSchedulesInfo(
        combinations
      );

    // The temporary Class[][] batch is no longer needed once Schedule objects exist.
    combinations.length = 0;

    this.logger.log(
      'sorting...'
    );


    schedules =
      this.sortByMostCompact(
        schedules
      );


    /*
     * Invalidate lazy sorting caches.
     */
    this.stateService.schedulesSortedByMostBalanced = null;

    this.stateService.schedulesSortedByMostFreeDays = null;


    await this.setBar(100);


    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          500
        )
    );


    this.logger.log(
      'done'
    );

    this.logger.log(
      'generated first batch',
      schedules.length
    );

    this.logger.log(
      'has more schedules',
      this.hasMoreSchedules()
    );


    return schedules;
  }


  /* ==========================================================================
   * NEXT BATCH
   * ======================================================================== */

  async generateNextBatch(): Promise<Schedule[]> {

    this.stateService.schedulesSortedByMostBalanced = null;
    this.stateService.schedulesSortedByMostFreeDays = null;
    this.stateService.schedulesSortedByMostCompact = null; // Clear all cached array references


    if (
      !this.hasMoreSchedules()
    ) {

      this.logger.log(
        'no more schedules'
      );

      return [];
    }


    this.logger.log(
      'generating next batch...'
    );


    await this.setBar(0);


    /*
     * IMPORTANT:
     *
     * This calls generate() on the EXISTING workers.
     *
     * They continue their internal DFS cursor.
     */
    const combinations =
      await this.runBatch(
        this.BATCH_SIZE
      );


    await this.setBar(90);


    let schedules =
      this.calculateSchedulesInfo(
        combinations
      );

    // The temporary Class[][] batch is no longer needed once Schedule objects exist.
    combinations.length = 0;

    schedules =
      this.sortByMostCompact(
        schedules
      );


    /*
     * New schedules invalidate sorting caches.
     */
    this.stateService.schedulesSortedByMostBalanced =
      null;

    this.stateService.schedulesSortedByMostFreeDays =
      null;


    await this.setBar(100);


    this.logger.log(
      'generated next batch',
      schedules.length
    );

    this.logger.log(
      'has more schedules',
      this.hasMoreSchedules()
    );


    return schedules;
  }


  /* ==========================================================================
   * HAS MORE
   * ======================================================================== */

  hasMoreSchedules(): boolean {

    if (
      !this.genState
    ) {

      return false;
    }


    if (
      this.genState.usingWorkers
    ) {

      return this.genState.workers.some(
        worker =>
          !worker.exhausted
      );
    }


    return !!(
      this.genState.singleState &&
      !this.genState.singleState.exhausted
    );
  }


  /* ==========================================================================
   * DISCARD INFO
   * ======================================================================== */

  discardScheduleInfo(scheduleIds: number[], keepIds: number[] = []): void {
  const keep = new Set<number>(keepIds);

  for (const id of scheduleIds) {
    if (!keep.has(id)) {
      this.generatedSchedulesInfo.delete(id);
    }
  }
}


  /* ==========================================================================
   * GENERATION STATE SETUP
   * ======================================================================== */

  private setupGenerationState(
    classesPerCourse: Class[][]
  ): void {

    /*
     * Clear old schedule metadata.
     */
    this.generatedSchedulesInfo.clear();


    /*
     * IDs restart ONLY for a completely new generation.
     */
    this.nextScheduleId = 0;


    this.genState = null;


    if (
      !classesPerCourse ||
      classesPerCourse.length === 0 ||
      classesPerCourse.some(
        classes =>
          classes.length === 0
      )
    ) {

      return;
    }


    /*
     * Search the smallest course first.
     */
    const classes =
      [...classesPerCourse]
        .sort(
          (a, b) =>
            a.length - b.length
        );


    const usingWorkers =
      this.getBrowserSupportForWorkers();


    /*
     * ------------------------------------------------------------------------
     * SINGLE THREAD
     * ------------------------------------------------------------------------
     */

    if (!usingWorkers) {

      this.genState = {
        classesPerCourse:
          classes,

        usingWorkers:
          false,

        workers:
          [],

        singleState: {
          current: [],
          indexes: new Array(
            Math.max(
              0,
              classes.length - 1
            )
          ).fill(0),
          firstIndex: 0,
          exhausted: false
        }
      };

      return;
    }


    /*
     * ------------------------------------------------------------------------
     * WORKERS
     * ------------------------------------------------------------------------
     */

    const hardwareConcurrency =
      window.navigator.hardwareConcurrency ||
      1;


    const numberOfWorkers =
      Math.max(
        1,
        Math.min(
          hardwareConcurrency,
          classes[0].length
        )
      );


    const classesPerWorker =
      Math.floor(
        classes[0].length /
        numberOfWorkers
      );


    let remainder =
      classes[0].length %
      numberOfWorkers;


    let startIndex = 0;


    const workers:
      {
        index: number;
        firstClassStart: number;
        firstClassCount: number;
        worker: Worker;
        exhausted: boolean;
        initialized: boolean;
      }[] = [];


    for (
      let i = 0;
      i < numberOfWorkers;
      i++
    ) {

      const count =
        classesPerWorker +
        (
          remainder > 0
            ? 1
            : 0
        );


      if (
        remainder > 0
      ) {

        remainder--;
      }


      const firstClassStart = startIndex;
      const firstClassCount = count;

      startIndex += count;


      const worker =
        new Worker(
          new URL(
            '../../_workers/generation-worker.worker',
            import.meta.url
          ),
          {
            type: 'module'
          }
        );


      workers.push({
        index:
          i + 1,

        firstClassStart,
        firstClassCount,

        worker,

        exhausted:
          firstClassCount === 0,

        initialized:
          false
      });
    }


    this.genState = {
      classesPerCourse:
        classes,

      usingWorkers:
        true,

      workers,

      singleState:
        null
    };


    this.initializeWorkers();
  }


  /* ==========================================================================
   * INITIALIZE PERSISTENT WORKERS
   * ======================================================================== */

  private initializeWorkers(): void {

    if (
      !this.genState ||
      !this.genState.usingWorkers
    ) {

      return;
    }


    for (
      const partition of
        this.genState.workers
    ) {

      if (
        partition.exhausted
      ) {

        partition.initialized = true;
        continue;
      }


      partition.worker.onerror =
        error => {

          this.logger.log(
            'generation worker error: ' +
            partition.index +
            ' - ' +
            String(error)
          );
        };


      /*
       * The normal generation listener is installed
       * later by runBatchWithWorkers().
       *
       * For initialization we use addEventListener so
       * it can coexist safely with the generation listener.
       */
      partition.worker.addEventListener(
        'message',
        ({data}) => {

          if (
            data.type === 'initialized'
          ) {

            partition.initialized = true;

            partition.exhausted =
              !!data.exhausted;
          }
        }
      );


      partition.worker.postMessage({
        type: 'init',

        classes:
          this.genState.classesPerCourse,

        firstClassStart:
          partition.firstClassStart,

        firstClassCount:
          partition.firstClassCount
      });
    }
  }


  /* ==========================================================================
   * WAIT FOR INITIALIZATION
   * ======================================================================== */

  private async waitForWorkersToInitialize(): Promise<void> {

    if (
      !this.genState ||
      !this.genState.usingWorkers
    ) {

      return;
    }


    const workers =
      this.genState.workers;


    /*
     * Workers with no assigned first classes are already exhausted.
     */
    if (
      workers.every(
        worker =>
          worker.initialized
      )
    ) {

      return;
    }


    await new Promise<void>(
      resolve => {

        const check =
          () => {

            if (
              !this.genState ||
              !this.genState.usingWorkers
            ) {

              resolve();
              return;
            }


            const initialized =
              this.genState.workers.every(
                worker =>
                  worker.initialized
              );


            if (
              initialized
            ) {

              resolve();
              return;
            }


            setTimeout(
              check,
              0
            );
          };


        check();
      }
    );
  }


  /* ==========================================================================
   * RUN BATCH
   * ======================================================================== */

  private async runBatch(
    batchSize: number
  ): Promise<Class[][]> {

    if (
      !this.genState
    ) {

      return [];
    }


    if (
      this.genState.usingWorkers
    ) {

      return this.runBatchWithWorkers(
        batchSize
      );
    }


    return this.runBatchSingleThread(
      batchSize
    );
  }


  /* ==========================================================================
   * PERSISTENT WORKER BATCH
   * ======================================================================== */

  private async runBatchWithWorkers(
    batchSize: number
  ): Promise<Class[][]> {

    const state = this.genState;

    if (!state || !state.usingWorkers) {
      return [];
    }

    const activePartitions =
      state.workers.filter(
        partition => !partition.exhausted
      );

    if (activePartitions.length === 0) {
      return [];
    }

    const perWorker =
      Math.floor(batchSize / activePartitions.length);

    let remainder =
      batchSize % activePartitions.length;

    const promises:
      Promise<{
        combinations: Class[][];
        exhausted: boolean;
        index: number;
      }>[] = [];

    for (const partition of activePartitions) {
      const take =
        perWorker + (remainder > 0 ? 1 : 0);

      if (remainder > 0) {
        remainder--;
      }

      if (take <= 0) {
        continue;
      }

      const promise = new Promise<{
        combinations: Class[][];
        exhausted: boolean;
        index: number;
      }>((resolve, reject) => {
        const worker = partition.worker;
        const combinations: Class[][] = [];
        let finished = false;

        const cleanup = () => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
        };

        const onMessage = ({data}: MessageEvent) => {
          if (data.type === 'result') {
            const chunk =
              this.decodeWorkerBatch(
                data.buffer as ArrayBuffer,
                data.count,
                state.classesPerCourse
              );

            combinations.push(...chunk);

            /*
             * The Uint32Array buffer was transferred to us. Once decode has
             * finished, there must be no explicit reference to it left.
             */
            if (data.buffer) {
              data.buffer = null;
            }

            if (data.done) {
              finished = true;
              cleanup();

              resolve({
                combinations,
                exhausted: !!data.exhausted,
                index: partition.index
              });
              return;
            }

            /*
             * Back-pressure: do NOT let the worker generate another chunk
             * until the previous one has been decoded by the main thread.
             */
            worker.postMessage({type: 'continue'});
            return;
          }

          if (data.type === 'error') {
            cleanup();
            reject(new Error(data.message));
          }
        };

        const onError = (error: ErrorEvent) => {
          cleanup();
          reject(error);
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);

        worker.postMessage({
          type: 'generate',
          take
        });
      });

      promises.push(promise);
    }

    const results = await Promise.all(promises);

    const combinations: Class[][] = [];

    for (const result of results) {
      const partition = state.workers.find(
        worker => worker.index === result.index
      );

      if (!partition) {
        continue;
      }

      partition.exhausted = result.exhausted;

      combinations.push(...result.combinations);

      result.combinations.length = 0;

      if (partition.exhausted) {
        partition.worker.terminate();
      }
    }

    return combinations;
  }


  private decodeWorkerBatch(
    buffer: ArrayBuffer,
    count: number,
    classesPerCourse: Class[][]
  ): Class[][] {

    const courseCount = classesPerCourse.length;

    if (
      !buffer ||
      count <= 0 ||
      courseCount === 0
    ) {
      return [];
    }

    const indexes = new Uint32Array(buffer);
    const combinations: Class[][] = new Array(count);

    for (let i = 0; i < count; i++) {
      const combination: Class[] = new Array(courseCount);
      const base = i * courseCount;

      for (let course = 0; course < courseCount; course++) {
        combination[course] =
          classesPerCourse[course][indexes[base + course]];
      }

      combinations[i] = combination;
    }

    return combinations;
  }


  /* ==========================================================================
   * SINGLE-THREAD PERSISTENT CURSOR
   * ======================================================================== */

  private async runBatchSingleThread(
    batchSize: number
  ): Promise<Class[][]> {

    const state =
      this.genState;


    if (
      !state ||
      state.usingWorkers ||
      !state.singleState
    ) {

      return [];
    }


    const generation =
      state.singleState;


    if (
      generation.exhausted
    ) {

      return [];
    }


    const classes =
      state.classesPerCourse;


    const combinations:
      Class[][] = [];


    while (
      combinations.length <
        batchSize &&
      !generation.exhausted
    ) {

      /*
       * Start first class.
       */
      if (
        generation.current.length === 0
      ) {

        if (
          generation.firstIndex >=
          classes[0].length
        ) {

          generation.exhausted = true;
          break;
        }


        generation.current.push(
          classes[0][
            generation.firstIndex
          ]
        );


        for (
          let i = 0;
          i < generation.indexes.length;
          i++
        ) {

          generation.indexes[i] = 0;
        }
      }


      /*
       * Complete schedule.
       */
      if (
        generation.current.length ===
        classes.length
      ) {

        combinations.push([
          ...generation.current
        ]);


        this.singleBacktrack(
          generation,
          classes
        );


        continue;
      }


      const courseIndex =
        generation.current.length;


      const stackIndex =
        courseIndex - 1;


      const courseClasses =
        classes[courseIndex];


      let classIndex =
        generation.indexes[
          stackIndex
        ];


      let found = false;


      while (
        classIndex <
        courseClasses.length
      ) {

        const cls =
          courseClasses[classIndex];


        generation.indexes[
          stackIndex
        ] =
          classIndex + 1;


        classIndex++;


        if (
          this.checkForOverlapWithCurrentClasses(
            cls,
            generation.current
          )
        ) {

          continue;
        }


        generation.current.push(
          cls
        );


        if (
          stackIndex + 1 <
          generation.indexes.length
        ) {

          generation.indexes[
            stackIndex + 1
          ] = 0;
        }


        found = true;

        break;
      }


      if (
        !found
      ) {

        generation.indexes[
          stackIndex
        ] = 0;


        this.singleBacktrack(
          generation,
          classes
        );
      }
    }


    return combinations;
  }


  private singleBacktrack(
    generation: {
      current: Class[];
      indexes: number[];
      firstIndex: number;
      exhausted: boolean;
    },
    classes: Class[][]
  ): void {

    if (
      generation.current.length > 0
    ) {

      generation.current.pop();
    }


    if (
      generation.current.length === 0
    ) {

      generation.firstIndex++;


      for (
        let i = 0;
        i < generation.indexes.length;
        i++
      ) {

        generation.indexes[i] = 0;
      }


      if (
        generation.firstIndex >=
        classes[0].length
      ) {

        generation.exhausted = true;
      }
    }
  }


  /* ==========================================================================
   * DISPOSE GENERATION
   * ======================================================================== */

  disposeGeneration(): void {
    this.destroyGenerationWorkers();
    this.generatedSchedulesInfo.clear();

    this.stateService.schedulesSortedByMostBalanced = null;
    this.stateService.schedulesSortedByMostFreeDays = null;
    this.stateService.schedulesSortedByMostCompact = null;
  }


  /* ==========================================================================
   * DESTROY WORKERS
   * ======================================================================== */

  private destroyGenerationWorkers(): void {

    if (
      !this.genState
    ) {

      return;
    }


    if (
      this.genState.usingWorkers
    ) {

      for (
        const partition of
          this.genState.workers
      ) {

        try {

          partition.worker.terminate();

        } catch (error) {

          /*
           * terminate() normally does not throw,
           * but don't let cleanup break a new generation.
           */
        }
      }
    }


    this.genState = null;
  }


  /* ==========================================================================
   * SHIFT COMBINATION
   * ======================================================================== */

  combineShiftsMain(
    courses: Course[]
  ): Class[][] {

    const classesPerCourse:
      Class[][] = [];


    for (
      const course of courses
    ) {

      classesPerCourse.push(
        this.combineShifts(course)
      );
    }


    return classesPerCourse;
  }


  combineShifts(
    course: Course
  ): Class[] {

    /*
     * Sort lessons chronologically.
     */
    if (
      course.shifts
    ) {

      for (
        const shift of course.shifts
      ) {

        if (
          !shift.lessons ||
          shift.lessons.length < 2
        ) {

          continue;
        }


        shift.lessons.sort(
          (a, b) => {

            const dayA =
              a.start.getDay();

            const dayB =
              b.start.getDay();


            if (
              dayA !== dayB
            ) {

              return dayA - dayB;
            }


            return (
              a.start.getTime() -
              b.start.getTime()
            );
          }
        );
      }
    }


    const shiftsMap =
      new Map<string, Shift[]>();


    const addToMap =
      (
        key: string,
        shift: Shift
      ): void => {

        const arr =
          shiftsMap.get(key);


        if (
          arr
        ) {

          arr.push(shift);

        } else {

          shiftsMap.set(
            key,
            [shift]
          );
        }
      };


    /*
     * Group shifts by type.
     */
    const byType =
      new Map<string, Shift[]>();


    for (
      const shift of
        course.shifts ?? []
    ) {

      const arr =
        byType.get(
          shift.type
        );


      if (
        arr
      ) {

        arr.push(shift);

      } else {

        byType.set(
          shift.type,
          [shift]
        );
      }
    }


    const maxSlotsForType =
      (
        shifts: Shift[]
      ): number => {

        let max = 0;


        for (
          const shift of
            shifts ?? []
        ) {

          const count =
            shift.lessons
              ? shift.lessons.length
              : 0;


          if (
            count > max
          ) {

            max = count;
          }
        }


        return max;
      };


    /*
     * Build shift groups.
     */
    for (
      const [
        type,
        shifts
      ] of byType.entries()
    ) {

      /*
       * Normal mode.
       */
      if (
        !this.stateService.mixShiftsEnabled ||
        !course.isIndividualLessonEnabled(
          type as any
        )
      ) {

        for (
          const shift of shifts
        ) {

          addToMap(
            type,
            shift
          );
        }


        continue;
      }


      /*
       * Individual lesson mode.
       */
      const maxSlots =
        maxSlotsForType(
          shifts
        );


      if (
        maxSlots < 2
      ) {

        for (
          const shift of shifts
        ) {

          addToMap(
            type,
            shift
          );
        }


        continue;
      }


      for (
        let slot = 0;
        slot < maxSlots;
        slot++
      ) {

        const key =
          `${type}__slot${slot}`;


        const candidates =
          shifts.filter(
            shift =>
              shift.lessons &&
              shift.lessons[slot]
          );


        if (
          candidates.length === 0
        ) {

          continue;
        }


        for (
          const shift of candidates
        ) {

          const lesson =
            shift.lessons[slot];


          const slotShift =
            new Shift(
              `${shift.name}#${slot + 1}`,
              type as any,
              [lesson],
              shift.campus
            );


          addToMap(
            key,
            slotShift
          );
        }
      }
    }


    /*
     * Cartesian product.
     */
    let combinations:
      Shift[][] = [];


    for (
      const [, shifts] of
        shiftsMap
    ) {

      const allCases =
        this.allPossibleCases([
          combinations,
          shifts
        ]);


      combinations = [];


      for (
        const combination of allCases
      ) {

        if (
          this.checkForOverlapsOnShifts(
            combination
          )
        ) {

          continue;
        }


        combinations.push(
          combination
        );
      }


      if (
        combinations.length === 0
      ) {

        break;
      }
    }


    /*
     * Convert Shift[][] to Class[].
     */
    const classes:
      Class[] = [];


    for (
      const combination of
        combinations
    ) {

      classes.push(
        new Class(
          course,
          combination
        )
      );
    }


    return classes;
  }


  /* ==========================================================================
   * LEGACY combineClasses
   * ======================================================================== */

  async combineClasses(
    classes: Class[][]
  ): Promise<Class[][]> {

    const MAX_GENERATED_SCHEDULES =
      this.BATCH_SIZE;


    if (
      !classes ||
      classes.length === 0
    ) {

      return [];
    }


    if (
      classes.some(
        cls =>
          cls.length === 0
      )
    ) {

      return [];
    }


    classes =
      [...classes].sort(
        (a, b) =>
          a.length - b.length
      );


    const combinations:
      Class[][] = [];


    const current:
      Class[] = [];


    const generate =
      (
        courseIndex: number
      ): boolean => {

        if (
          combinations.length >=
          MAX_GENERATED_SCHEDULES
        ) {

          return true;
        }


        if (
          courseIndex ===
          classes.length
        ) {

          combinations.push([
            ...current
          ]);

          return false;
        }


        for (
          const cls of
            classes[courseIndex]
        ) {

          if (
            this.checkForOverlapWithCurrentClasses(
              cls,
              current
            )
          ) {

            continue;
          }


          current.push(cls);


          const stop =
            generate(
              courseIndex + 1
            );


          current.pop();


          if (
            stop
          ) {

            return true;
          }
        }


        return false;
      };


    generate(0);


    return combinations;
  }


  /* ==========================================================================
   * CARTESIAN PRODUCT
   * ======================================================================== */

  allPossibleCases(
    array: any[][]
  ): any[][] {

    /*
     * Remove empty arrays.
     */
    for (
      let i = array.length - 1;
      i >= 0;
      i--
    ) {

      if (
        array[i].length === 0
      ) {

        array.splice(i, 1);
      }
    }


    if (
      array.length === 0
    ) {

      return [];
    }


    return allPossibleCasesHelper(
      array,
      true
    );


    function allPossibleCasesHelper(
      arr: any[][],
      isFirst: boolean
    ): any[][] {

      if (
        arr.length === 1
      ) {

        if (
          isFirst
        ) {

          for (
            let i = 0;
            i < arr[0].length;
            i++
          ) {

            arr[0][i] =
              [arr[0][i]];
          }
        }


        return arr[0];
      }


      const result:
        any[][] = [];


      const allCasesOfRest =
        allPossibleCasesHelper(
          arr.slice(1),
          false
        );


      for (
        let rest of allCasesOfRest
      ) {

        for (
          let item of arr[0]
        ) {

          if (
            !Array.isArray(item)
          ) {

            item = [item];
          }


          if (
            !Array.isArray(rest)
          ) {

            rest = [rest];
          }


          result.push(
            item.concat(rest)
          );
        }
      }


      return result;
    }
  }


  /* ==========================================================================
   * OVERLAP CHECKING
   * ======================================================================== */

  checkForOverlapsOnShifts(
    shifts: Shift[]
  ): boolean {

    for (
      let i = 0;
      i < shifts.length - 1;
      i++
    ) {

      for (
        let j = i + 1;
        j < shifts.length;
        j++
      ) {

        if (
          shifts[i].overlap(
            shifts[j]
          )
        ) {

          return true;
        }
      }
    }


    return false;
  }


  checkForOverlapsOnClasses(
    classes: Class[]
  ): boolean {

    for (
      let i = 0;
      i < classes.length - 1;
      i++
    ) {

      for (
        let j = i + 1;
        j < classes.length;
        j++
      ) {

        if (
          classes[i].overlap(
            classes[j]
          )
        ) {

          return true;
        }
      }
    }


    return false;
  }


  checkForOverlapWithCurrentClasses(
    cls: Class,
    current: Class[]
  ): boolean {

    for (
      const selectedClass of
        current
    ) {

      if (
        cls.overlap(
          selectedClass
        )
      ) {

        return true;
      }
    }


    return false;
  }


  /* ==========================================================================
   * SCHEDULE INFORMATION
   * ======================================================================== */

  calculateSchedulesInfo(
    combinations: Class[][]
  ): Schedule[] {

    const schedules:
      Schedule[] = [];


    for (
      const combination of
        combinations
    ) {

      const schedule =
        new Schedule(
          this.nextScheduleId++,
          combination
        );


      schedules.push(
        schedule
      );


      const data =
        this.prepareData(
          1,
          schedule.classes
        );


      const proximity =
        this.calculateProximityLevel(
          schedule,
          data.allLessons
        );


      const holesInfo =
        this.countHoles(
          data.classesPerWeekday
        );


      const deviation =
        this.calculateDeviation(
          data.classesPerWeekday
        );


      const freeDays =
        this.calculateNumberFreeDays(
          data.classesPerWeekday
        );


      this.generatedSchedulesInfo.set(
        schedule.id,
        {
          proximity,
          nr_holes:
            holesInfo.nr_holes,
          total_duration:
            holesInfo.total_duration,
          total_deviation:
            deviation,
          nr_free_days:
            freeDays,
          events:
            data.events
        }
      );
    }


    return schedules;
  }


  prepareData(
    tag: number,
    classes: Class[]
  ): {
    allLessons: Lesson[],
    classesPerWeekday:
      Map<
        number,
        {start: number, end: number}[]
      >,
    events: Event[]
  } {

    const allLessons:
      Lesson[] = [];


    const classesPerWeekday =
      new Map<
        number,
        {start: number, end: number}[]
      >();


    const events:
      Event[] = [];


    for (
      const cl of classes
    ) {

      const acronym =
        cl.course.acronym;


      for (
        const shift of cl.shifts
      ) {

        const type =
          minifyClassType(
            shift.type
          );


        const pinned = false;


        for (
          const lesson of shift.lessons
        ) {

          allLessons.push(
            lesson
          );


          const key =
            lesson.start.getDay();


          const value = {
            start:
              getTimestamp(
                formatTime(
                  lesson.start
                )
              ),

            end:
              getTimestamp(
                formatTime(
                  lesson.end
                )
              )
          };


          if (
            classesPerWeekday.has(key)
          ) {

            classesPerWeekday
              .get(key)
              .push(value);

          } else {

            classesPerWeekday.set(
              key,
              [value]
            );
          }


          const weekday =
            getWeekday(
              lesson.start.getDay()
            );


          const start =
            formatTime(
              lesson.start
            );


          const end =
            formatTime(
              lesson.end
            );


          const name =
            acronym.replace(
              /[0-9]/g,
              ''
            ) +
            ' (' +
            type +
            ')';


          events.push(
            new Event(
              shift.name,
              tag,
              weekday,
              start,
              end,
              name,
              lesson.room,
              pinned
            )
          );
        }
      }


      tag++;
    }


    for (
      let i = 1;
      i <= 5;
      i++
    ) {

      if (
        classesPerWeekday.has(i) &&
        classesPerWeekday.get(i).length > 1
      ) {

        classesPerWeekday
          .get(i)
          .sort(
            (a, b) =>
              a.start - b.start
          );
      }
    }


    return {
      allLessons,
      classesPerWeekday,
      events
    };
  }


  countHoles(
    classesPerWeekday:
      Map<
        number,
        {start: number, end: number}[]
      >
  ): {
    nr_holes: number,
    total_duration: number
  } {

    let numberOfHoles = 0;
    let totalDuration = 0;


    for (
      let i = 1;
      i <= 5;
      i++
    ) {

      if (
        classesPerWeekday.has(i) &&
        classesPerWeekday.get(i).length > 1
      ) {

        const classes =
          classesPerWeekday.get(i);


        for (
          let j = 0;
          j < classes.length - 1;
          j++
        ) {

          const current =
            classes[j];


          const next =
            classes[j + 1];


          if (
            next.start >
            current.end
          ) {

            numberOfHoles++;


            totalDuration +=
              next.start -
              current.end;
          }
        }
      }
    }


    return {
      nr_holes:
        numberOfHoles,

      total_duration:
        totalDuration
    };
  }


  calculateProximityLevel(
    schedule: Schedule,
    allLessons: Lesson[]
  ): number {

    let proximity = 0;


    for (
      let i = 0;
      i < allLessons.length - 1;
      i++
    ) {

      const lesson1Start =
        getTimestamp(
          formatTime(
            allLessons[i].start
          )
        );


      const lesson1Day =
        allLessons[i].start.getDay();


      for (
        let j = i + 1;
        j < allLessons.length;
        j++
      ) {

        const lesson2Start =
          getTimestamp(
            formatTime(
              allLessons[j].start
            )
          );


        const lesson2Day =
          allLessons[j].start.getDay();


        proximity +=
          Math.abs(
            lesson1Start -
            lesson2Start
          ) +
          Math.abs(
            lesson1Day -
            lesson2Day
          );
      }
    }


    return proximity;
  }


  calculateDeviation(
    classesPerWeekday:
      Map<
        number,
        {start: number, end: number}[]
      >
  ): number {

    const hoursPerWeekDay =
      new Map<number, number>();


    let totalHoursPerWeek = 0;


    classesPerWeekday.forEach(
      (value, key) => {

        let total = 0;


        value.forEach(
          classTimes => {

            total +=
              classTimes.end -
              classTimes.start;
          }
        );


        hoursPerWeekDay.set(
          key,
          total
        );


        totalHoursPerWeek +=
          total;
      }
    );


    const balancedIndex =
      totalHoursPerWeek / 5;


    let deviation = 0;


    hoursPerWeekDay.forEach(
      value => {

        deviation +=
          Math.abs(
            balancedIndex -
            value
          );
      }
    );


    return deviation;
  }


  calculateNumberFreeDays(
    classesPerWeekday:
      Map<
        number,
        {start: number, end: number}[]
      >
  ): number {

    let freeDays = 0;


    for (
      let i = 1;
      i <= 5;
      i++
    ) {

      if (
        !classesPerWeekday.has(i) ||
        classesPerWeekday.get(i).length === 0
      ) {

        freeDays++;
      }
    }


    return freeDays;
  }


  /* ==========================================================================
   * SORTING
   * ======================================================================== */

  sortByMostCompact(
    schedules: Schedule[]
  ): Schedule[] {

    return [...schedules].sort(
      (a, b) => {

        const infoA =
          this.generatedSchedulesInfo.get(
            a.id
          );


        const infoB =
          this.generatedSchedulesInfo.get(
            b.id
          );


        if (
          !infoA ||
          !infoB
        ) {

          return 0;
        }


        if (
          infoA.nr_holes !==
          infoB.nr_holes
        ) {

          return (
            infoA.nr_holes -
            infoB.nr_holes
          );
        }


        if (
          infoA.total_duration !==
          infoB.total_duration
        ) {

          return (
            infoA.total_duration -
            infoB.total_duration
          );
        }


        return (
          infoA.proximity -
          infoB.proximity
        );
      }
    );
  }


  sortByMostBalanced(
    schedules: Schedule[]
  ): Schedule[] {

    const sorted =
      [...schedules].sort(
        (a, b) => {

          const infoA =
            this.generatedSchedulesInfo.get(
              a.id
            );


          const infoB =
            this.generatedSchedulesInfo.get(
              b.id
            );


          if (
            !infoA ||
            !infoB
          ) {

            return 0;
          }


          if (
            infoA.total_deviation !==
            infoB.total_deviation
          ) {

            return (
              infoA.total_deviation -
              infoB.total_deviation
            );
          }


          if (
            infoA.nr_holes !==
            infoB.nr_holes
          ) {

            return (
              infoA.nr_holes -
              infoB.nr_holes
            );
          }


          return (
            infoA.total_duration -
            infoB.total_duration
          );
        }
      );


    this.stateService.schedulesSortedByMostBalanced =
      [...sorted];


    return sorted;
  }


  sortByMostFreeDays(
    schedules: Schedule[]
  ): Schedule[] {

    const sorted =
      [...schedules].sort(
        (a, b) => {

          const infoA =
            this.generatedSchedulesInfo.get(
              a.id
            );


          const infoB =
            this.generatedSchedulesInfo.get(
              b.id
            );


          if (
            !infoA ||
            !infoB
          ) {

            return 0;
          }


          if (
            infoA.nr_free_days !==
            infoB.nr_free_days
          ) {

            return (
              infoB.nr_free_days -
              infoA.nr_free_days
            );
          }


          if (
            infoA.nr_holes !==
            infoB.nr_holes
          ) {

            return (
              infoA.nr_holes -
              infoB.nr_holes
            );
          }


          return (
            infoA.total_duration -
            infoB.total_duration
          );
        }
      );


    this.stateService.schedulesSortedByMostFreeDays =
      [...sorted];


    return sorted;
  }


  /* ==========================================================================
   * DATA PARSING
   * ======================================================================== */

  parseData(
    data: any
  ): Class[][] {

    const final:
      Class[][] = [];


    for (
      const item of data
    ) {

      const classes:
        Class[] = [];


      for (
        const subItem of item
      ) {

        const course =
          getCourse(
            subItem._course._name,
            this.stateService.selectedCourses
          );


        const shifts =
          getShifts(
            subItem._shifts
          );


        classes.push(
          new Class(
            course,
            shifts
          )
        );
      }


      final.push(
        classes
      );
    }


    return final;


    function getCourse(
      name: string,
      courses: Course[]
    ): Course {

      for (
        const course of courses
      ) {

        if (
          course.name === name
        ) {

          return course;
        }
      }


      return null;
    }


    function getShifts(
      shs: any[]
    ): Shift[] {

      const shifts:
        Shift[] = [];


      for (
        const shift of shs
      ) {

        const lessons:
          Lesson[] = [];


        for (
          const lesson of shift._lessons
        ) {

          lessons.push(
            new Lesson(
              new Date(
                lesson._start
              ),
              new Date(
                lesson._end
              ),
              lesson._room,
              lesson._campus
            )
          );
        }


        shifts.push(
          new Shift(
            shift._name,
            shift._type,
            lessons,
            shift._campus
          )
        );
      }


      return shifts;
    }
  }


  /* ==========================================================================
   * WORKER SUPPORT
   * ======================================================================== */

  getBrowserSupportForWorkers(): boolean {

    return typeof Worker !== 'undefined';
  }
}