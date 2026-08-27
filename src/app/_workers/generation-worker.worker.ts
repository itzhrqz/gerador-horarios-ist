/// <reference lib="webworker" />

import {Class} from '../_domain/Class/Class';
import {Course} from '../_domain/Course/Course';
import {Shift} from '../_domain/Shift/Shift';
import {Lesson} from '../_domain/Lesson/Lesson';
import {Degree} from '../_domain/Degree/Degree';
import {ClassType} from '../_domain/ClassType/ClassType';
import {formatTime, getTimestamp} from '../_util/Time';


addEventListener('message', ({data}) => {

  if (data.type !== 'generate')
    return;

  console.log('Worker #' + data.worker + ' working...');

  const classes: Class[][] = parseClassesPerCourse(data.classes);
  const firstClasses: Class[] = parseClasses(data.firstClasses);

  const maxCombinations: number = data.maxCombinations;

  const combinations: Class[][] = [];
  const current: Class[] = [];

  /*
   * Each worker receives a subset of the classes of the first course.
   *
   * Example:
   *
   * Course 1: [A, B, C, D, E, F]
   *
   * Worker 1: [A, B]
   * Worker 2: [C, D]
   * Worker 3: [E, F]
   *
   * This guarantees that workers explore different parts
   * of the search tree.
   */
  for (const firstClass of firstClasses) {

    if (combinations.length >= maxCombinations)
      break;

    current.push(firstClass);

    generateCombinations(
      classes,
      1,
      current,
      combinations,
      maxCombinations
    );

    current.pop();
  }

  postMessage({
    type: 'result',
    combinations
  });

  console.log(
    'Worker #' + data.worker +
    ' finished! Generated ' +
    combinations.length +
    ' combinations.'
  );

  postMessage({
    type: 'finished'
  });
});


/* --------------------------------------------------------------------------------
 * Generates valid combinations incrementally using backtracking.
 *
 * IMPORTANT:
 *
 * This does NOT generate the Cartesian product first.
 *
 * If a class overlaps with something already selected, that entire branch
 * is discarded immediately.
 *
 * Therefore:
 *
 *     allPossibleCases()
 *
 * is no longer necessary.
 * -------------------------------------------------------------------------------- */

function generateCombinations(
  classesPerCourse: Class[][],
  courseIndex: number,
  current: Class[],
  combinations: Class[][],
  maxCombinations: number
): void {

  /*
   * Stop immediately when the worker has reached its limit.
   */
  if (combinations.length >= maxCombinations)
    return;

  /*
   * A class has been selected for every course.
   *
   * Therefore we have found one valid schedule.
   */
  if (courseIndex >= classesPerCourse.length) {
    combinations.push([...current]);
    return;
  }

  const classes = classesPerCourse[courseIndex];

  for (const cls of classes) {

    /*
     * Don't continue searching after reaching the limit.
     */
    if (combinations.length >= maxCombinations)
      return;

    /*
     * Check the new class against everything already selected.
     */
    if (checkForOverlapWithCurrentClasses(cls, current))
      continue;

    /*
     * Choose this class.
     */
    current.push(cls);

    /*
     * Explore the rest of the tree.
     */
    generateCombinations(
      classesPerCourse,
      courseIndex + 1,
      current,
      combinations,
      maxCombinations
    );

    /*
     * Undo the choice.
     *
     * This is the key property of backtracking:
     * `current` never contains more than one path through the tree.
     */
    current.pop();
  }
}


/* --------------------------------------------------------------------------------
 * Checks whether a class overlaps with any class already selected.
 *
 * We only need to compare against the current partial schedule.
 * -------------------------------------------------------------------------------- */

function checkForOverlapWithCurrentClasses(
  cls: Class,
  current: Class[]
): boolean {

  for (const selectedClass of current)
    if (overlapClass(cls, selectedClass))
      return true;

  return false;
}


function overlapClass(
  class1: any,
  class2: any
): boolean {

  for (const shift of class1._shifts)
    for (const otherShift of class2._shifts)
      if (overlapShift(shift, otherShift))
        return true;

  return false;
}


function overlapShift(
  shift1: any,
  shift2: any
): boolean {

  for (const lesson of shift1._lessons)
    for (const otherLesson of shift2._lessons)
      if (overlapLesson(lesson, otherLesson))
        return true;

  return false;
}


function overlapLesson(
  lesson1: any,
  lesson2: any
): boolean {

  /*
   * Do NOT mutate the lesson objects here.
   *
   * The old implementation did:
   *
   *     lesson1.start = new Date(...)
   *
   * which is unnecessary.
   */

  const start1 = new Date(lesson1._start);
  const end1 = new Date(lesson1._end);

  const start2 = new Date(lesson2._start);
  const end2 = new Date(lesson2._end);

  const weekDay1 = start1.getDay();
  const weekDay2 = start2.getDay();

  /*
   * Lessons on different days cannot overlap.
   */
  if (weekDay1 !== weekDay2)
    return false;

  const startTime1 = getTimestamp(formatTime(start1));
  const endTime1 = getTimestamp(formatTime(end1));

  const startTime2 = getTimestamp(formatTime(start2));
  const endTime2 = getTimestamp(formatTime(end2));

  /*
   * Standard interval overlap test:
   *
   * A.start < B.end && B.start < A.end
   *
   * Therefore:
   *
   * 09:30 - 11:00
   * 11:00 - 12:30
   *
   * are NOT considered overlapping.
   */
  return startTime1 < endTime2 &&
         startTime2 < endTime1;
}


/* --------------------------------------------------------------------------------
 * Converts the serialized Class[][] received through postMessage()
 * back into Class instances.
 * -------------------------------------------------------------------------------- */

function parseClassesPerCourse(data: any[][]): Class[][] {

  const result: Class[][] = [];

  for (const classes of data)
    result.push(parseClasses(classes));

  return result;
}


function parseClasses(data: any[]): Class[] {

  const classes: Class[] = [];

  for (const item of data) {

    const course = getCourse(item._course);
    const shifts = getShifts(item._shifts);

    classes.push(new Class(course, shifts));
  }

  return classes;
}


function getCourse(course): Course {

  const shifts = getShifts(course._shifts);

  const types: ClassType[] = [];

  for (const type of course._types)
    types.push(type);

  const campus: string[] = [];

  for (const camp of course._campus)
    campus.push(camp);

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


function getShifts(shs): Shift[] {

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