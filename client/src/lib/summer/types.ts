export type WeekNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type DayNo = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type VenueName = '新北高中' | '三重商工' | '三民高中';
export type DutyRole = 'frontdesk' | 'lifeguard';
export type DutyPeriod = 'weekday' | 'sat' | 'sun';
export type ManualPeriod = `manual-day-${DayNo}`;
export type CoursePeriod = DutyPeriod | ManualPeriod;
export type IsoDate = string & { readonly __brand: 'IsoDate' };
export type CellKey = string & { readonly __brand: 'CellKey' };

export type EmployeeId = number | string;

export interface WeekConfig {
  no: WeekNo;
  start: IsoDate;
  end: IsoDate;
  activeWeekdays: readonly DayNo[];
  weekday: string;
  sat: string;
  sun: string;
  label: string;
}

export interface CourseSlot {
  code: string;
  time: string;
}

export interface CourseConfig {
  name: string;
  slots: readonly CourseSlot[];
}

export interface VenueConfig {
  venueId: number;
  name: VenueName;
  lifeguardMin: number;
  lifeguardMax: number;
  tags: readonly string[];
  duty: readonly (readonly [string, string])[];
  courses: readonly CourseConfig[];
  holidayCourses: readonly CourseConfig[];
}

export interface Employee {
  id: EmployeeId;
  name: string;
  role: string;
  venueId: EmployeeId | '';
  venueName: string;
  lineBound: boolean;
  lineDisplayName: string;
  lineBoundAt: string;
}

export interface EmployeeMeta {
  employeeId: EmployeeId;
  employeeName: string;
  lineBound: boolean;
  role: string;
  venueId: EmployeeId | '';
  venueName: string;
}

export interface TimeRange {
  start: number;
  end: number;
  label: string;
}

export interface LooseTimeRange extends TimeRange {
  raw: string;
}

export type NameAliases = Readonly<Record<string, string>>;

export interface RawEntry {
  key: string;
  value: string;
  employees: EmployeeMeta[];
}

export interface Draft {
  cells: ReadonlyMap<string, string>;
  meta: ReadonlyMap<string, readonly EmployeeMeta[]>;
}

export type CoachRole = '教練' | '當班下' | '助教' | '跟課';

interface AssignmentBase {
  weekNo: number;
  venueId: string;
  venueName: string;
  courseId: '';
  slotId: '';
  days: DayNo[];
  startTime: string;
  endTime: string;
  employeeId: EmployeeId | '';
  employeeName: string;
  role: string;
  lineBound: boolean;
  rawName: string;
  follow: boolean;
}

export interface CourseAssignment extends AssignmentBase {
  roleType: 'course';
  courseName: string;
  slotCode: string;
  dateType: CoursePeriod;
  source: 'registration' | 'manual';
  coachRole: CoachRole;
  requiredCoaches: string;
  registeredCount: string;
  manualCourseId: string;
  date: string;
}

export interface DutyAssignment extends AssignmentBase {
  roleType: DutyRole;
  courseName: '';
  slotCode: '';
  dateType: DutyPeriod;
  source: 'schedule';
  coachRole: '';
}

export type NormalizedAssignment = CourseAssignment | DutyAssignment;

export interface PortalShiftRow {
  employeeId: number;
  venueId: number;
  date: string;
  startTime: string;
  endTime: string;
  role: '救生' | '櫃台' | '教練';
  notes: string;
  status: 'active';
  source: 'summer-schedule-v40';
  weekNo: number;
  roleType: NormalizedAssignment['roleType'];
  courseName: string;
  slotCode: string;
  manualCourseId: string;
  originalAssignment: NormalizedAssignment;
}

export interface SaveSchedulePayload {
  version: 'v40';
  weekNo: WeekNo;
  generatedAt: string;
  rawEntries: RawEntry[];
  assignments: NormalizedAssignment[];
  shifts: PortalShiftRow[];
}

export interface ManualCourse {
  id: number | string;
  source: 'manual';
  date: string;
  weekNo: number;
  venueId: EmployeeId | '';
  venueName: string;
  courseName: string;
  startTime: string;
  endTime: string;
  registeredCount: number;
  requiredCoaches: number;
  note: string;
  updatedAt: string;
  employeeId?: EmployeeId;
  employeeName?: string;
}

export interface EnrollmentItem {
  weekNo: number;
  venueId: string;
  courseName: string;
  slotCode: string;
  registeredCount: number;
  isClosed: boolean;
  closureReason: string | null;
}

export type EnrollmentState =
  | { kind: 'loading' }
  | { kind: 'loaded'; weekNo: WeekNo; items: readonly EnrollmentItem[]; lastUpdated: string | null }
  | { kind: 'failed'; message: string };
