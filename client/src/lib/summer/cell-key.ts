import { slug } from './parse';
import type { CellKey, CourseConfig, DayNo, DutyRole, VenueName, WeekNo } from './types';

export type CourseField = 'enroll' | 'needed' | 'note' | 'weekday' | 'sat' | 'sun';
export type ManualField = 'name' | 'enroll' | 'needed' | 'coach' | 'note';
export type AvailabilityField = 'name' | 'venues' | 'weekday' | 'sat' | 'sun' | 'note';

const key = (s: string) => s as CellKey;

export const weekPrefix = (week: WeekNo) => `w${week}-`;

export function courseRowId(courseName: string, code: string, kind: 'weekday' | 'holiday'): string {
  return kind === 'weekday' ? `${slug(courseName)}-${code}` : `holiday-${slug(courseName)}-${code}`;
}

export function courseCellKey(week: WeekNo, venue: VenueName, rowId: string, field: CourseField): CellKey {
  return key(`w${week}-${venue}-course-${rowId}-${field}`);
}

export function overrideKey(enrollKey: CellKey): CellKey {
  return key(`${enrollKey}:override`);
}

export function manualCellKey(week: WeekNo, venue: VenueName, id: number | string, field: ManualField): CellKey {
  return key(`w${week}-${venue}-manual-${id}-${field}`);
}

export function dutyGridCellKey(week: WeekNo, venue: VenueName, role: DutyRole, row: number, dayNo: DayNo): CellKey {
  return key(`w${week}-${venue}-${role}-dutygrid-r${row}-d${dayNo}`);
}

export function dutyGridRowsKey(week: WeekNo, venue: VenueName, role: DutyRole): CellKey {
  return key(`w${week}-${venue}-${role}-dutygrid-rows`);
}

export function availabilityKey(week: WeekNo, no: number, field: AvailabilityField): CellKey {
  return key(`w${week}-availability-${no}-${field}`);
}

export function manualCourseIdFromCoachKey(k: string): string {
  const m = /-manual-(\d+)-coach$/.exec(String(k || ''));
  return m ? m[1] : '';
}

export function isScheduleValueKey(k: string): boolean {
  return !k.includes('-availability-') && !k.includes('-dutygrid-rows') && !/-course-.*-enroll$/.test(k);
}

export function courseRows(course: CourseConfig, kind: 'weekday' | 'holiday') {
  return course.slots.map(s => ({ courseName: course.name, code: s.code, time: s.time, id: courseRowId(course.name, s.code, kind) }));
}
