// tslint:disable:max-line-length
import { EventEmitter, Injectable } from '@angular/core';

import {LoggerService} from '../../_util/logger.service';
import {StateService} from '../state/state.service';

import {Schedule} from '../../_domain/Schedule/Schedule';
import {Class} from '../../_domain/Class/Class';
import {Course} from '../../_domain/Course/Course';
import {Shift} from '../../_domain/Shift/Shift';
import {Lesson} from '../../_domain/Lesson/Lesson';
import {Event} from '../../_domain/Event/Event';

import {formatTime, getTimestamp, getWeekday} from '../../_util/Time';
import {minifyClassType} from '../../_domain/ClassType/ClassType';

@Injectable({
  providedIn: 'root'
})
export class SchedulesGenerationService {

  generatedSchedulesInfo: Map<number, { // scheduleID -> info
    proximity: number,
    nr_holes: number,
    total_duration: number,
    total_deviation: number,
    nr_free_days: number,
    events: Event[]
  }> = new Map<number, { proximity: number, nr_holes: number, total_duration: number, total_deviation: number, nr_free_days: number, events: Event[] }>();

  updateBar: any = () => console.log('updateBar not defined');
  setBar: any = () => console.log('setBar not defined');

  constructor(public logger: LoggerService, private stateService: StateService) {
  }

  setBarFunctions(updateBar: any, setBar: any): void {
    this.updateBar = updateBar;
    this.setBar = setBar;
  }

  /* --------------------------------------------------------------------------------
   * Returns generated schedules based on user selected courses.
   * --------------------------------------------------------------------------------
   * [Algorithm]
   *  - get all combinations of shifts for a given course (taking into account hours
   *    per week of each type of class selected); check for overlaps and discard
   *  - combine each to create different schedules; check for overlaps and discard
   *  - calculate relevant info for all types of sorting for all schedules
   *  - sort by most compact (default)
   * -------------------------------------------------------------------------------- */
  async generateSchedules(courses: Course[]): Promise<Schedule[]> {
    this.logger.log('generating...');
    await this.setBar(0);

    // Combine shifts
    const classesPerCourse: Class[][] = await this.combineShiftsMain(courses);

    await this.setBar(10);

    // Combine classes
    this.logger.log('combining classes...');
    const combinations: Class[][] = await this.combineClasses(classesPerCourse);

    await this.setBar(90);

    // Calculate relevant info
    this.logger.log('calculating info...');
    let schedules: Schedule[] = this.calculateSchedulesInfo(combinations);

    // Sort by most compact
    this.logger.log('sorting...');
    schedules = this.sortByMostCompact(schedules);

    await this.setBar(100);

    // Clean previous states
    this.stateService.schedulesSortedByMostBalanced = null;
    this.stateService.schedulesSortedByMostFreeDays = null;

    await new Promise(resolve => setTimeout(resolve, 500)); // sleep (To show 100%)
    this.logger.log('done');
    return schedules;
  }

  combineShiftsMain(courses: Course[]): Class[][] {
    // Combine shifts
    this.logger.log('combining shifts...');
    const classesPerCourse: Class[][] = [];
    for (const course of courses) {
      const classes = this.combineShifts(course);
      classesPerCourse.push(classes);
    }
    return classesPerCourse;
  }

  /* --------------------------------------------------------------------------------
   * Sorts schedules by most compact
   * --------------------------------------------------------------------------------
   * [Heuristic Preference Order]
   *  - less #holes
   *  - smaller sum of total duration + proximity level
   *  - more balanced
   *  - more free days
   * -------------------------------------------------------------------------------- */
  sortByMostCompact(schedules: Schedule[]): Schedule[] {
    schedules.sort((a, b) => {
      const aInfo = this.generatedSchedulesInfo.get(a.id);
      const bInfo = this.generatedSchedulesInfo.get(b.id);
      const compactSumA = aInfo.total_duration + aInfo.proximity;
      const compactSumB = bInfo.total_duration + bInfo.proximity;

      if (aInfo.nr_holes === bInfo.nr_holes) {
        if (compactSumA === compactSumB)
          return aInfo.total_deviation === bInfo.total_deviation ?
            bInfo.nr_free_days - aInfo.nr_free_days : aInfo.total_deviation - bInfo.total_deviation;
        return compactSumA - compactSumB;
      }
      return aInfo.nr_holes - bInfo.nr_holes;
    });

    // Save state
    this.stateService.schedulesSortedByMostCompact = [...schedules];

    this.logger.log('Sorted by most compact', schedules);
    return [...schedules];
  }

  /* --------------------------------------------------------------------------------
   * Sorts schedules by most balanced
   * --------------------------------------------------------------------------------
   * [Heuristic]
   *  - more balanced
   *  - more compact
   *  - more free days
   * -------------------------------------------------------------------------------- */
  sortByMostBalanced(schedules: Schedule[]): Schedule[] {
    schedules.sort((a, b) => {
      const aInfo = this.generatedSchedulesInfo.get(a.id);
      const bInfo = this.generatedSchedulesInfo.get(b.id);
      const compactSumA = aInfo.total_duration + aInfo.proximity;
      const compactSumB = bInfo.total_duration + bInfo.proximity;

      if (aInfo.total_deviation === bInfo.total_deviation) {
        if (aInfo.nr_holes === bInfo.nr_holes)
          return compactSumA === compactSumB ? bInfo.nr_free_days - aInfo.nr_free_days : compactSumA - compactSumB;
        return aInfo.nr_holes - bInfo.nr_holes;
      }
      return aInfo.total_deviation - bInfo.total_deviation;
    });

    // Save state
    this.stateService.schedulesSortedByMostBalanced = [...schedules];

    this.logger.log('Sorted by most balanced', schedules);
    return [...schedules];
  }

  /* --------------------------------------------------------------------------------
   * Sorts schedules by most free days
   * --------------------------------------------------------------------------------
   * [Heuristic]
   *  - more free days
   *  - more compact
   *  - more balanced
   * -------------------------------------------------------------------------------- */
  sortByMostFreeDays(schedules: Schedule[]): Schedule[] {
    schedules.sort((a, b) => {
      const aInfo = this.generatedSchedulesInfo.get(a.id);
      const bInfo = this.generatedSchedulesInfo.get(b.id);
      const compactSumA = aInfo.total_duration + aInfo.proximity;
      const compactSumB = bInfo.total_duration + bInfo.proximity;

      if (aInfo.nr_free_days === bInfo.nr_free_days) {
        if (aInfo.nr_holes === bInfo.nr_holes)
          return compactSumA === compactSumB ?
            aInfo.total_deviation - bInfo.total_deviation : compactSumA - compactSumB;
        return aInfo.nr_holes - bInfo.nr_holes;
      }
      return bInfo.nr_free_days - aInfo.nr_free_days;
    });

    // Save state
    this.stateService.schedulesSortedByMostFreeDays = [...schedules];

    this.logger.log('Sorted by most free days', schedules);
    return [...schedules];
  }

  combineShifts(course: Course): Class[] {
    
     if (course.shifts) {
      for (const shift of course.shifts) {
        if (!shift.lessons || shift.lessons.length < 2) continue;

        shift.lessons.sort((a, b) => {
          const dayA = a.start.getDay();
          const dayB = b.start.getDay();
          if (dayA !== dayB) return dayA - dayB;

          return a.start.getTime() - b.start.getTime();
        });
      }
    }

    
    
    const shiftsMap = new Map<string, Shift[]>();

       const addToMap = (key: string, s: Shift) => {
      const arr = shiftsMap.get(key);
      if (arr) arr.push(s);
      else shiftsMap.set(key, [s]);
    };

    // Group shifts by type first
    const byType = new Map<string, Shift[]>();
    for (const shift of course.shifts ?? []) {
      const arr = byType.get(shift.type);
      if (arr) arr.push(shift);
      else byType.set(shift.type, [shift]);
    }

    const maxSlotsForType = (shifts: Shift[]): number => {
      let max = 0;
      for (const s of shifts ?? []) {
        const c = s.lessons ? s.lessons.length : 0;
        if (c > max) max = c;
      }
      return max;
    };

    // Build shiftsMap (normal mode or individual-slot mode)
    for (const [type, shifts] of byType.entries()) {

      if (!this.stateService.mixShiftsEnabled || !course.isIndividualLessonEnabled(type as any)) {
        // Choose one shift for this type
        for (const shift of shifts) addToMap(type, shift);
        continue;
      }

      // Individual enabled: allow splitting into per-weekly-slot choices (if there are >=2 slots)
      const maxSlots = maxSlotsForType(shifts);

      if (maxSlots < 2) {
        // Nothing to split -> fallback to normal
        for (const shift of shifts) addToMap(type, shift);
        continue;
      }

      for (let slot = 0; slot < maxSlots; slot++) {
        const key = `${type}__slot${slot}`;

        // Only shifts that actually have this slot contribute candidates
        const candidates = shifts.filter(s => s.lessons && s.lessons[slot]);
        if (candidates.length === 0) continue;

        for (const shift of candidates) {
          const lesson = shift.lessons[slot];
          const slotShift = new Shift(`${shift.name}#${slot + 1}`, type as any, [lesson], shift.campus);
          addToMap(key, slotShift);
        }
      }
    }



    // Get combinations of shifts
    let combinations: Shift[][] = [];
    for (const [key, value] of shiftsMap) {
      const shifts = value;
      const allCases = this.allPossibleCases([combinations, shifts]);
      combinations = [];
      for (const combination of allCases) {
        // Check for overlaps and discard
        if (this.checkForOverlapsOnShifts(combination)) continue;
        combinations.push(combination);
      }
      if (combinations.length === 0) break;
    }

    // Arrange into classes
    const classes: Class[] = [];
    for (const combination of combinations)
      classes.push(new Class(course, combination));
    return classes;
  }

async combineClasses(classes: Class[][]): Promise<Class[][]> {

  /*
   * ============================================
   * CONFIGURATION
   * ============================================
   *
   * Change this number directly in the code.
   *
   * Example:
   *
   * 100000 = maximum 100K generated schedules
   * 500000 = maximum 500K generated schedules
   */
  const MAX_GENERATED_SCHEDULES = 500000;


  /*
   * No classes => no schedules.
   */
  if (!classes || classes.length === 0)
    return [];


  /*
   * If one course has no possible class,
   * there cannot be a complete schedule.
   */
  if (classes.some(cls => cls.length === 0))
    return [];


  /*
   * Courses with fewer possibilities first.
   *
   * This is already done in your old implementation and is
   * especially useful for backtracking because it makes the
   * search tree narrower near the root.
   */
  classes.sort((a, b) => a.length - b.length);


  /*
   * Check whether Web Workers are available.
   */
  const browserSupportsWebWorkers =
    this.getBrowserSupportForWorkers();


  /*
   * ==========================================================
   * FALLBACK: NO WEB WORKERS
   * ==========================================================
   *
   * We still use incremental backtracking.
   *
   * Most importantly, we DO NOT use allPossibleCases().
   */
  if (!browserSupportsWebWorkers) {

    const combinations: Class[][] = [];
    const current: Class[] = [];

    const generate = (courseIndex: number): boolean => {

      /*
       * Maximum reached.
       */
      if (combinations.length >= MAX_GENERATED_SCHEDULES)
        return true;


      /*
       * Complete valid schedule.
       */
      if (courseIndex === classes.length) {
        combinations.push([...current]);
        return false;
      }


      /*
       * Try every possible class for this course.
       */
      for (const cls of classes[courseIndex]) {

        /*
         * Check only against classes already selected.
         */
        if (this.checkForOverlapWithCurrentClasses(
          cls,
          current
        ))
          continue;


        current.push(cls);

        const limitReached = generate(courseIndex + 1);

        current.pop();


        if (limitReached)
          return true;
      }

      return false;
    };


    generate(0);

    return combinations;
  }


  /*
   * ==========================================================
   * WEB WORKERS
   * ==========================================================
   */

  const numberOfWorkers = Math.max(
    1,
    Math.min(
      window.navigator.hardwareConcurrency || 1,
      classes[0].length
    )
  );


  /*
   * We split the FIRST course between workers.
   *
   * Suppose:
   *
   *   first course = 100 classes
   *   workers = 4
   *
   * then approximately:
   *
   *   worker 1 -> 25 classes
   *   worker 2 -> 25 classes
   *   worker 3 -> 25 classes
   *   worker 4 -> 25 classes
   *
   * Each worker explores a completely different part
   * of the search tree.
   */

  const workers: Worker[] = [];

  const workerPromises: Promise<Class[][]>[] = [];


  /*
   * Divide first-course classes between workers.
   */
  const classesPerWorker =
    Math.floor(classes[0].length / numberOfWorkers);

  let remainder =
    classes[0].length % numberOfWorkers;


  let startIndex = 0;


  for (let workerIndex = 0;
       workerIndex < numberOfWorkers;
       workerIndex++) {

    /*
     * Distribute the remainder amongst the first workers.
     */
    const numberForThisWorker =
      classesPerWorker +
      (remainder > 0 ? 1 : 0);

    if (remainder > 0)
      remainder--;


    const firstClasses =
      classes[0].slice(
        startIndex,
        startIndex + numberForThisWorker
      );

    startIndex += numberForThisWorker;


    /*
     * Create worker.
     */
    const worker = new Worker(
      new URL(
        '../../_workers/generation-worker.worker',
        import.meta.url
      ),
      {type: 'module'}
    );


    workers.push(worker);


    /*
     * Give each worker a fraction of the maximum.
     *
     * This prevents every worker from independently generating
     * MAX_GENERATED_SCHEDULES.
     */
    const maxForWorker = Math.ceil(
      MAX_GENERATED_SCHEDULES / numberOfWorkers
    );


    /*
     * Convert the worker's message into a Promise.
     */
    const promise = new Promise<Class[][]>(
      (resolve, reject) => {

        worker.onmessage = ({data}) => {

          if (data.type === 'result') {
            resolve(
              this.parseData(data.combinations)
            );
          }

          if (data.type === 'error') {
            reject(
              new Error(data.message)
            );
          }
        };


        worker.onerror = (error) => {
          reject(error);
        };
      }
    );


    workerPromises.push(promise);


    /*
     * Send ONLY:
     *
     * - all possible classes
     * - this worker's first-course partition
     * - its result limit
     *
     * We do NOT send a gigantic `combinations` array.
     */
    worker.postMessage({
      type: 'generate',

      worker: workerIndex + 1,

      classes,

      firstClasses,

      maxCombinations: maxForWorker
    });
  }


  /*
   * Wait for all workers.
   */
  const workerResults =
    await Promise.all(workerPromises);


  /*
   * Always terminate workers.
   */
  for (const worker of workers)
    worker.terminate();


  /*
   * Merge results.
   *
   * At most MAX_GENERATED_SCHEDULES are kept.
   */
  const combinations: Class[][] = [];

  for (const result of workerResults) {

    const remaining =
      MAX_GENERATED_SCHEDULES -
      combinations.length;

    if (remaining <= 0)
      break;

    combinations.push(
      ...result.slice(0, remaining)
    );
  }


  this.logger.log(
    'Generated ' +
    combinations.length +
    ' schedules (limit: ' +
    MAX_GENERATED_SCHEDULES +
    ')'
  );


  return combinations;
}

  /* --------------------------------------------------------------------------------
   * Returns all possible combinations between different arrays.
   * --------------------------------------------------------------------------------
   * For example:
   * array = [ ['a', 'b'], ['c'], ['d', 'e', 'f'] ]
   *
   * result = [ ['a', 'c', 'd'], ['b', 'c', 'd'], ['a', 'c', 'e'], ['b', 'c', 'e'],
   *          ['a', 'c', 'f'], ['b', 'c', 'f'] ]
   * --------------------------------------------------------------------------------
   * [Reference]
   * https://stackoverflow.com/questions/4331092/finding-all-combinations-cartesian-
   * product-of-javascript-array-values
   * -------------------------------------------------------------------------------- */
  allPossibleCases(array: any[][]): any[][] {
    // Clean array: if any is [] remove
    for (let i = array.length - 1; i >= 0; i--)
      if (array[i].length === 0) array.splice(i, 1);

    // Nothing to combine
    if (array.length === 0) return [];

    return allPossibleCasesHelper(array, true);

    function allPossibleCasesHelper(arr: any[][], isFirst: boolean): any[][] {
      if (arr.length === 1) {
        if (isFirst)
          // Make an array of every item, if nothing to combine
          for (let i = 0; i < arr[0].length; i++)
            arr[0][i] = [arr[0][i]];
        return arr[0];

      } else {
        const result = [];
        const allCasesOfRest = allPossibleCasesHelper(arr.slice(1), false);
        for (let rest of allCasesOfRest) {
          for (let item of arr[0]) {
            if (!Array.isArray(item)) item = [item];
            if (!Array.isArray(rest)) rest = [rest];
            result.push(item.concat(rest));
          }
        }
        return result;
      }
    }
  }

  checkForOverlapsOnShifts(shifts: Shift[]): boolean {
    for (let i = 0; i < shifts.length - 1; i++)
      for (let j = i + 1; j < shifts.length; j++)
        if (shifts[i].overlap(shifts[j])) return true;
    return false;
  }

  checkForOverlapsOnClasses(classes: Class[]): boolean {
    for (let i = 0; i < classes.length - 1; i++)
      for (let j = i + 1; j < classes.length; j++)
        if (classes[i].overlap(classes[j])) return true;
    return false;
  }

  checkForOverlapWithCurrentClasses(
  cls: Class,
  current: Class[]
): boolean {

  for (const selectedClass of current) {

    if (cls.overlap(selectedClass))
      return true;
  }

  return false;
}

  calculateSchedulesInfo(combinations: Class[][]): Schedule[] {
    let id = 0;
    const schedules: Schedule[] = [];

    for (const combination of combinations) {
      // Arrange into schedules
      const schedule = new Schedule(id++, combination);
      schedules.push(schedule);

      // Get info
      const data = this.prepareData(1, schedule.classes);
      const allLessons: Lesson[] = data.allLessons;
      const classesPerWeekday: Map<number, { start: number, end: number }[]> = data.classesPerWeekday;
      const events: Event[] = data.events;

      const proximity = this.calculateProximityLevel(schedule, allLessons);
      const holesInfo = this.countHoles(classesPerWeekday);
      const deviation = this.calculateDeviation(classesPerWeekday);
      const freeDays = this.calculateNumberFreeDays(classesPerWeekday);

      this.generatedSchedulesInfo.set(schedule.id, {
        proximity,
        nr_holes: holesInfo.nr_holes,
        total_duration: holesInfo.total_duration,
        total_deviation: deviation,
        nr_free_days: freeDays,
        events
      });
    }
    return schedules;
  }

  prepareData(tag: number, classes: Class[]): { allLessons: Lesson[], classesPerWeekday: Map<number, { start: number, end: number }[]>, events: Event[] } {
    const allLessons: Lesson[] = [];
    const classesPerWeekday = new Map<number, { start: number, end: number }[]>();
    const events: Event[] = [];

    for (const cl of classes) {
      const acronym = cl.course.acronym;

      for (const shift of cl.shifts) {
        const type = minifyClassType(shift.type);
        const pinned = false;

        for (const lesson of shift.lessons) {
          // Get all lessons
          allLessons.push(lesson);

          // Get classes per weekday
          const key = lesson.start.getDay();
          const value = {start: getTimestamp(formatTime(lesson.start)), end: getTimestamp(formatTime(lesson.end))};
          classesPerWeekday.has(key) ? classesPerWeekday.get(key).push(value) : classesPerWeekday.set(key, [value]);

          // Get events
          const weekday = getWeekday(lesson.start.getDay());
          const start = formatTime(lesson.start);
          const end = formatTime(lesson.end);
          const name = acronym.replace(/[0-9]/g, '') + ' (' + type + ')';
          const place = lesson.room;
          events.push(new Event(shift.name, tag, weekday, start, end, name, place, pinned));
        }
      }
      tag++;
    }

    // Sort classes per weekday by start time
    for (let i = 1; i <= 5; i++)
      if (classesPerWeekday.has(i) && classesPerWeekday.get(i).length > 1)
        classesPerWeekday.get(i).sort((a, b) => a.start - b.start);

    return {allLessons, classesPerWeekday, events};
  }

  countHoles(classesPerWeekday: Map<number, { start: number, end: number }[]>): { nr_holes: number, total_duration: number } {
    let numberOfHoles = 0;
    let totalDuration = 0;

    for (let i = 1; i <= 5; i++) {
      if (classesPerWeekday.has(i) && classesPerWeekday.get(i).length > 1) {
        const classes = classesPerWeekday.get(i);

        for (let j = 0; j < classes.length - 1; j++) {
          const current = classes[j];
          const next = classes[j + 1];

          if (next.start > current.end) { // there's a hole
            numberOfHoles++;
            totalDuration += next.start - current.end;
          }
        }
      }
    }
    return {nr_holes: numberOfHoles, total_duration: totalDuration};
  }

  calculateProximityLevel(schedule: Schedule, allLessons: Lesson[]): number {
    let proximity = 0;

    for (let i = 0; i < allLessons.length - 1; i++) {
      const lesson1Start = getTimestamp(formatTime(allLessons[i].start));
      const lesson1Day = allLessons[i].start.getDay();

      for (let j = i + 1; j < allLessons.length; j++) {
        const lesson2Start = getTimestamp(formatTime(allLessons[j].start));
        const lesson2Day = allLessons[j].start.getDay();
        proximity += Math.abs(lesson1Start - lesson2Start) + Math.abs(lesson1Day - lesson2Day);
      }
    }
    return proximity;
  }

  calculateDeviation(classesPerWeekday: Map<number, { start: number, end: number }[]>): number {
    const hoursPerWeekDay: Map<number, number> = new Map();
    let totalHoursPerWeek = 0;

    // Get hours per weekday
    classesPerWeekday.forEach((value, key) => {
      let total = 0;
      value.forEach(classTimes => {
        total += classTimes.end - classTimes.start;
      });
      hoursPerWeekDay.set(key, total);
      totalHoursPerWeek += total;
    });

    // Calculate Balanced Index
    const balancedIndex = totalHoursPerWeek / 5;

    // Calculate deviation from Balanced Index
    let deviation = 0;
    hoursPerWeekDay.forEach(value => {
      deviation += Math.abs(balancedIndex - value);
    });
    return deviation;
  }

  calculateNumberFreeDays(classesPerWeekday: Map<number, { start: number, end: number }[]>): number {
    let freeDays = 0;
    for (let i = 1; i <= 5; i++)
      if (!classesPerWeekday.has(i) || classesPerWeekday.get(i).length === 0) freeDays++;
    return freeDays;
  }

  parseData(data): Class[][] {
    const final: Class[][] = [];
    for (const item of data) {
      const classes: Class[] = [];
      for (const subItem of item) {
        const course = getCourse(subItem._course._name, this.stateService.selectedCourses);
        const shifts = getShifts(subItem._shifts);
        classes.push(new Class(course, shifts));
      }
      final.push(classes);
    }
    return final;

    function getCourse(name: string, courses: Course[]): Course {
      for (const course of courses)
        if (course.name === name) return course;
      return null;
    }

    function getShifts(shs): Shift[] {
      const shifts: Shift[] = [];
      for (const shift of shs) {
        const lessons: Lesson[] = [];
        for (const lesson of shift._lessons)
          lessons.push(new Lesson(new Date(lesson._start), new Date(lesson._end), lesson._room, lesson._campus));
        shifts.push(new Shift(shift._name, shift._type, lessons, shift._campus));
      }
      return shifts;
    }
  }

  getBrowserSupportForWorkers(): boolean {
    return typeof Worker !== 'undefined';
  }
}
