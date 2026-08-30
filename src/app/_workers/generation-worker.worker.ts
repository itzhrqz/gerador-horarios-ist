/// <reference lib="webworker" />

import {Class} from '../_domain/Class/Class';
import {Course} from '../_domain/Course/Course';
import {Shift} from '../_domain/Shift/Shift';
import {Lesson} from '../_domain/Lesson/Lesson';
import {Degree} from '../_domain/Degree/Degree';
import {ClassType} from '../_domain/ClassType/ClassType';
import {formatTime, getTimestamp} from '../_util/Time';


interface GeneratorState {
  classesPerCourse: Class[][];
  firstClassStart: number;
  firstClassCount: number;
  current: Class[];
  currentIndexes: number[];
  stackIndexes: number[];
  exhausted: boolean;
  generated: number;
  firstClassIndex: number;
  pendingRemaining: number;
  pendingTakeTotal: number;
}


const RESULT_CHUNK_SIZE = 10000;

let state: GeneratorState | null = null;


addEventListener(
  'message',
  ({data}) => {
    try {
      if (!data || !data.type) {
        return;
      }

      if (data.type === 'init') {
        const classesPerCourse = parseClassesPerCourse(data.classes);
        const firstClassStart = Math.max(0, Number(data.firstClassStart) || 0);
        const firstClassCount = Math.max(0, Number(data.firstClassCount) || 0);

        state = {
          classesPerCourse,
          firstClassStart,
          firstClassCount,
          current: [],
          currentIndexes: [],
          stackIndexes: new Array(
            Math.max(0, classesPerCourse.length - 1)
          ).fill(0),
          exhausted:
            classesPerCourse.length === 0 || firstClassCount === 0,
          generated: 0,
          firstClassIndex: 0,
          pendingRemaining: 0,
          pendingTakeTotal: 0
        };

        postMessage({
          type: 'initialized',
          exhausted: state.exhausted
        });
        return;
      }

      if (data.type === 'generate') {
        if (!state) {
          postMessage({
            type: 'error',
            message: 'Generation worker received generate before init.'
          });
          return;
        }

        /*
         * Only one generate request may be active at a time.
         * Results are deliberately streamed in small transferable chunks.
         */
        if (state.pendingRemaining > 0) {
          postMessage({
            type: 'error',
            message: 'Generation worker received overlapping generate request.'
          });
          return;
        }

        const take = Math.max(0, Number(data.take) || 0);

        state.pendingRemaining = take;
        state.pendingTakeTotal = take;

        emitNextChunk(state);
        return;
      }

      if (data.type === 'continue') {
        if (!state) {
          return;
        }

        emitNextChunk(state);
        return;
      }

      if (data.type === 'reset') {
        state = null;
        postMessage({type: 'reset'});
        return;
      }
    } catch (error) {
      postMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }
);


function emitNextChunk(
  generator: GeneratorState
): void {
  if (generator.pendingRemaining <= 0) {
    return;
  }

  const chunkTake = Math.min(
    RESULT_CHUNK_SIZE,
    generator.pendingRemaining
  );

  const result = generateNextBatch(
    generator,
    chunkTake
  );

  generator.pendingRemaining -= result.count;

  const done =
    generator.pendingRemaining <= 0 ||
    result.exhausted ||
    result.count === 0;

  /*
   * The buffer is TRANSFERRED, not cloned.
   * After postMessage returns, ownership belongs to the main thread.
   */
  postMessage(
    {
      type: 'result',
      buffer: result.buffer,
      count: result.count,
      exhausted: result.exhausted,
      generated: generator.generated,
      done
    },
    [result.buffer]
  );

  if (done) {
    generator.pendingRemaining = 0;
    generator.pendingTakeTotal = 0;
  }
}


function generateNextBatch(
  generator: GeneratorState,
  take: number
): {
  buffer: ArrayBuffer;
  count: number;
  exhausted: boolean;
  generated: number;
} {
  const courseCount = generator.classesPerCourse.length;

  /* One Uint32 per course per schedule. */
  const indexes = new Uint32Array(
    Math.max(0, take * courseCount)
  );

  let count = 0;

  if (
    generator.exhausted ||
    take <= 0 ||
    courseCount === 0
  ) {
    return {
      buffer: indexes.buffer,
      count: 0,
      exhausted: generator.exhausted,
      generated: generator.generated
    };
  }

  /* ------------------------------------------------------------------------
   * ONE COURSE
   * ---------------------------------------------------------------------- */

  if (courseCount === 1) {
    while (
      count < take &&
      generator.firstClassIndex < generator.firstClassCount
    ) {
      indexes[count] =
        generator.firstClassStart + generator.firstClassIndex;

      generator.firstClassIndex++;
      generator.generated++;
      count++;
    }

    if (
      generator.firstClassIndex >=
      generator.firstClassCount
    ) {
      generator.exhausted = true;
    }

    return {
      buffer: indexes.buffer,
      count,
      exhausted: generator.exhausted,
      generated: generator.generated
    };
  }

  /* ------------------------------------------------------------------------
   * GENERAL CASE
   * ---------------------------------------------------------------------- */

  while (
    count < take &&
    !generator.exhausted
  ) {
    if (generator.current.length === 0) {
      if (
        generator.firstClassIndex >=
        generator.firstClassCount
      ) {
        generator.exhausted = true;
        break;
      }

      const globalFirstIndex =
        generator.firstClassStart +
        generator.firstClassIndex;

      generator.current.push(
        generator.classesPerCourse[0][globalFirstIndex]
      );

      generator.currentIndexes.push(globalFirstIndex);

      for (
        let i = 0;
        i < generator.stackIndexes.length;
        i++
      ) {
        generator.stackIndexes[i] = 0;
      }
    }

    if (
      generator.current.length ===
      generator.classesPerCourse.length
    ) {
      const base = count * courseCount;

      for (
        let i = 0;
        i < courseCount;
        i++
      ) {
        indexes[base + i] = generator.currentIndexes[i];
      }

      count++;
      generator.generated++;

      backtrack(generator);
      continue;
    }

    const courseIndex = generator.current.length;
    const stackIndex = courseIndex - 1;
    const classes = generator.classesPerCourse[courseIndex];

    let classIndex =
      generator.stackIndexes[stackIndex];

    let found = false;

    while (classIndex < classes.length) {
      const cls = classes[classIndex];

      generator.stackIndexes[stackIndex] =
        classIndex + 1;

      classIndex++;

      if (
        checkForOverlapWithCurrentClasses(
          cls,
          generator.current
        )
      ) {
        continue;
      }

      generator.current.push(cls);
      generator.currentIndexes.push(classIndex - 1);

      if (
        stackIndex + 1 <
        generator.stackIndexes.length
      ) {
        generator.stackIndexes[stackIndex + 1] = 0;
      }

      found = true;
      break;
    }

    if (!found) {
      generator.stackIndexes[stackIndex] = 0;
      backtrack(generator);
    }
  }

  return {
    buffer: indexes.buffer,
    count,
    exhausted: generator.exhausted,
    generated: generator.generated
  };
}


function backtrack(
  generator: GeneratorState
): void {
  if (generator.current.length > 0) {
    generator.current.pop();
    generator.currentIndexes.pop();
  }

  if (generator.current.length === 0) {
    generator.firstClassIndex++;

    for (
      let i = 0;
      i < generator.stackIndexes.length;
      i++
    ) {
      generator.stackIndexes[i] = 0;
    }

    if (
      generator.firstClassIndex >=
      generator.firstClassCount
    ) {
      generator.exhausted = true;
    }
  }
}


function checkForOverlapWithCurrentClasses(
  cls: Class,
  current: Class[]
): boolean {
  for (const selectedClass of current) {
    if (overlapClass(cls, selectedClass)) {
      return true;
    }
  }
  return false;
}


function overlapClass(
  class1: any,
  class2: any
): boolean {
  for (const shift of class1._shifts) {
    for (const otherShift of class2._shifts) {
      if (overlapShift(shift, otherShift)) {
        return true;
      }
    }
  }
  return false;
}


function overlapShift(
  shift1: any,
  shift2: any
): boolean {
  for (const lesson of shift1._lessons) {
    for (const otherLesson of shift2._lessons) {
      if (overlapLesson(lesson, otherLesson)) {
        return true;
      }
    }
  }
  return false;
}


function overlapLesson(
  lesson1: any,
  lesson2: any
): boolean {
  const start1 = new Date(lesson1._start);
  const end1 = new Date(lesson1._end);
  const start2 = new Date(lesson2._start);
  const end2 = new Date(lesson2._end);

  const weekDay1 = start1.getDay();
  const weekDay2 = start2.getDay();

  if (weekDay1 !== weekDay2) {
    return false;
  }

  const startTime1 = getTimestamp(formatTime(start1));
  const endTime1 = getTimestamp(formatTime(end1));
  const startTime2 = getTimestamp(formatTime(start2));
  const endTime2 = getTimestamp(formatTime(end2));

  return (
    startTime1 < endTime2 &&
    startTime2 < endTime1
  );
}


function parseClassesPerCourse(
  data: any[][]
): Class[][] {
  const result: Class[][] = [];

  for (const classes of data) {
    result.push(parseClasses(classes));
  }

  return result;
}


function parseClasses(
  data: any[]
): Class[] {
  const classes: Class[] = [];

  for (const item of data) {
    const course = getCourse(item._course);
    const shifts = getShifts(item._shifts);

    classes.push(
      new Class(
        course,
        shifts
      )
    );
  }

  return classes;
}


function getCourse(
  course: any
): Course {
  const shifts = getShifts(course._shifts);

  const types: ClassType[] = [];
  for (const type of course._types) {
    types.push(type);
  }

  const campus: string[] = [];
  for (const camp of course._campus) {
    campus.push(camp);
  }

  return new Course(
    course._id,
    course._name,
    course._acronym,
    course._credits,
    course._semester,
    course._period,
    types,
    campus,
    shifts,
    course._courseLoads,
    new Degree(
      course._degree._id,
      course._degree._name,
      course._degree._acronym
    )
  );
}


function getShifts(
  shs: any[]
): Shift[] {
  const shifts: Shift[] = [];

  for (const shift of shs) {
    const lessons: Lesson[] = [];

    for (const lesson of shift._lessons) {
      lessons.push(
        new Lesson(
          new Date(lesson._start),
          new Date(lesson._end),
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
