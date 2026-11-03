import { normalizeCoachCellText } from './cell-edits';
import { courseCellKey, courseRows, dutyGridCellKey, dutyGridRowsKey, manualCellKey, overrideKey } from './cell-key';
import { FORCE_OPEN_KEYWORDS, VENUES } from './config';
import { datesInWeek, dayNoOf, isIsoDate, type WeekDate } from './dates';
import { enrollmentLookupKeys, indexEnrollment, rowEnrollment, type Closure, type EnrollmentIndex } from './enrollment';
import { manualCoursesForVenue } from './manual-course';
import { normalizeCellText, parseTimeRange, venueIdByName } from './parse';
import { createRoster, type ParseContext, type Roster } from './roster';
import type {
  CellKey,
  CoursePeriod,
  DayNo,
  Draft,
  DutyRole,
  Employee,
  EnrollmentState,
  ManualCourse,
  ManualPeriod,
  NameAliases,
  TimeRange,
  VenueConfig,
  WeekConfig,
} from './types';

export interface WeekInput {
  week: WeekConfig;
  draft: Draft;
  employees: readonly Employee[];
  aliases: NameAliases;
  manualCourses: readonly ManualCourse[];
  enrollment: EnrollmentState;
}

export interface CoachCell {
  key: CellKey;
  period: CoursePeriod;
  text: string;
}

export type EnrollDisplay =
  | { kind: 'loading'; text: '...' }
  | { kind: 'unavailable'; text: '' }
  | { kind: 'closed'; text: '0'; reason: string | null }
  | { kind: 'override'; text: string; systemCount: number }
  | { kind: 'system'; text: string; systemCount: number };

interface CourseRowBase {
  venue: VenueConfig;
  rowId: string;
  courseName: string;
  slotCode: string;
  timeLabel: string;
  time: TimeRange | null;
  enrollKey: CellKey;
  neededKey: CellKey;
  noteKey: CellKey;
  coachCells: CoachCell[];
  enrollText: string;
  neededText: string;
}

export interface RegistrationCourseRow extends CourseRowBase {
  kind: 'weekday' | 'holiday';
  enroll: EnrollDisplay;
  forceOpen: boolean;
  zeroEnroll: boolean;
  noteText: string;
}

export interface ManualCourseRow extends CourseRowBase {
  kind: 'manual';
  course: ManualCourse;
  dateLabelIso: string;
  noteText: string;
}

export type CourseRow = RegistrationCourseRow | ManualCourseRow;

export interface DutyCell {
  venue: VenueConfig;
  role: DutyRole;
  row: number;
  date: WeekDate;
  key: CellKey;
  text: string;
}

export interface VenueModel {
  venue: VenueConfig;
  dutyCells: Record<DutyRole, DutyCell[]>;
  dutyRowCount: Record<DutyRole, number>;
  courseRows: CourseRow[];
}

export interface WeekModel {
  week: WeekConfig;
  dates: WeekDate[];
  ctx: ParseContext;
  draft: Draft;
  venues: VenueModel[];
  derivedCells: ReadonlyMap<string, string | null>;
}

const cellValue = (draft: Draft, key: string) => draft.cells.get(key) ?? '';

export function dutyRowCount(draft: Draft, key: string): number {
  const n = parseInt(String(draft.cells.get(key) || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function isForceOpen(noteText: string): boolean {
  return FORCE_OPEN_KEYWORDS.some(k => noteText.includes(k));
}

function currentEnrollment(state: EnrollmentState, week: WeekConfig): { kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; index: EnrollmentIndex } {
  if (state.kind === 'failed') return { kind: 'failed' };
  if (state.kind === 'loading' || state.weekNo !== week.no) return { kind: 'loading' };
  return { kind: 'loaded', index: indexEnrollment(state.items) };
}

function deriveNeeded(current: string, enroll: EnrollDisplay): string {
  if (enroll.kind === 'closed') return '0';
  if (enroll.kind === 'system' || enroll.kind === 'override') {
    if (enroll.systemCount === 0) return '0';
    if (current === '0') return '';
  }
  return current;
}

function buildRegistrationRows(venue: VenueConfig, input: WeekInput, enrollment: ReturnType<typeof currentEnrollment>, writes: Map<string, string | null>): RegistrationCourseRow[] {
  const { week, draft } = input;
  const venueId = String(venue.venueId || venueIdByName(venue.name) || '');
  const read = (key: string) => (writes.has(key) ? writes.get(key) ?? '' : cellValue(draft, key));
  const kinds: ['weekday' | 'holiday', VenueConfig['courses']][] = [
    ['weekday', venue.courses],
    ['holiday', venue.holidayCourses],
  ];
  return kinds.flatMap(([kind, courses]) =>
    courses.flatMap(course =>
      courseRows(course, kind).map(r => {
        const enrollKey = courseCellKey(week.no, venue.name, r.id, 'enroll');
        const neededKey = courseCellKey(week.no, venue.name, r.id, 'needed');
        const noteKey = courseCellKey(week.no, venue.name, r.id, 'note');
        const ovKey = overrideKey(enrollKey);
        const isOverride = read(ovKey) === '1' && (writes.get(ovKey) !== null);
        let enroll: EnrollDisplay;
        if (enrollment.kind === 'loading') {
          enroll = isOverride ? { kind: 'override', text: read(enrollKey), systemCount: NaN } : { kind: 'loading', text: '...' };
        } else if (enrollment.kind === 'failed') {
          enroll = isOverride ? { kind: 'override', text: read(enrollKey), systemCount: NaN } : { kind: 'unavailable', text: '' };
        } else {
          const { count, closure } = rowEnrollment(enrollment.index, enrollmentLookupKeys(week.no, venueId, r.courseName, r.code, kind));
          enroll = enrollDisplayFor(count, closure, isOverride, draft.cells.has(enrollKey) ? read(enrollKey) : null);
          if (enroll.kind === 'closed') writes.set(ovKey, null);
          writes.set(enrollKey, enroll.text);
        }
        const noteText = normalizeCellText(read(noteKey));
        const forceOpen = isForceOpen(noteText);
        const currentNeeded = normalizeCellText(read(neededKey)).trim();
        let neededText = currentNeeded;
        if (enrollment.kind === 'loaded') {
          neededText = deriveNeeded(currentNeeded, enroll);
          writes.set(neededKey, neededText);
        }
        const enrollNumber = parseInt(enroll.text, 10);
        const zeroEnroll = Number.isFinite(enrollNumber) && enrollNumber === 0 && !forceOpen;
        if (zeroEnroll && neededText !== '0') {
          neededText = '0';
          writes.set(neededKey, '0');
        }
        const periods: CoursePeriod[] = kind === 'weekday' ? ['weekday'] : ['sat', 'sun'];
        return {
          kind,
          venue,
          rowId: r.id,
          courseName: r.courseName,
          slotCode: r.code,
          timeLabel: r.time,
          time: parseTimeRange(r.time),
          enrollKey,
          neededKey,
          noteKey,
          coachCells: periods.map(period => {
            const key = courseCellKey(week.no, venue.name, r.id, period as 'weekday' | 'sat' | 'sun');
            return { key, period, text: normalizeCellText(read(key)) };
          }),
          enroll,
          enrollText: enroll.text,
          neededText,
          noteText,
          forceOpen,
          zeroEnroll,
        };
      }),
    ),
  );
}

function enrollDisplayFor(count: number, closure: Closure, isOverride: boolean, saved: string | null): EnrollDisplay {
  if (closure.isClosed) return { kind: 'closed', text: '0', reason: closure.reason };
  if (isOverride) return { kind: 'override', text: saved !== null ? String(saved) : String(count), systemCount: count };
  return { kind: 'system', text: String(count), systemCount: count };
}

function buildManualRows(venue: VenueConfig, input: WeekInput, read: (key: string) => string): ManualCourseRow[] {
  const { week } = input;
  return manualCoursesForVenue(input.manualCourses, venue, week).map(course => {
    const day = (isIsoDate(course.date) ? dayNoOf(course.date) : 1) as DayNo;
    const coachKey = manualCellKey(week.no, venue.name, course.id, 'coach');
    const timeLabel = `${course.startTime}-${course.endTime}`;
    return {
      kind: 'manual',
      venue,
      course,
      rowId: `manual-${course.id}`,
      courseName: course.courseName,
      slotCode: 'MANUAL',
      timeLabel,
      time: parseTimeRange(timeLabel),
      enrollKey: manualCellKey(week.no, venue.name, course.id, 'enroll'),
      neededKey: manualCellKey(week.no, venue.name, course.id, 'needed'),
      noteKey: manualCellKey(week.no, venue.name, course.id, 'note'),
      coachCells: [{ key: coachKey, period: `manual-day-${day}` as ManualPeriod, text: normalizeCellText(read(coachKey)) }],
      enrollText: String(course.registeredCount),
      neededText: String(course.requiredCoaches),
      noteText: normalizeCellText(course.note ?? ''),
      dateLabelIso: course.date,
    };
  });
}

export function buildWeekModel(input: WeekInput): WeekModel {
  const { week, draft } = input;
  const roster: Roster = createRoster(input.employees);
  const ctx: ParseContext = { roster, aliases: input.aliases, meta: draft.meta };
  const dates = datesInWeek(week);
  const writes = new Map<string, string | null>();
  const enrollment = currentEnrollment(input.enrollment, week);
  const read = (key: string) => (writes.has(key) ? writes.get(key) ?? '' : cellValue(draft, key));

  const venues = VENUES.map(venue => {
    const registration = buildRegistrationRows(venue, input, enrollment, writes);
    const manual = buildManualRows(venue, input, read);
    const courseRowsList: CourseRow[] = [...registration, ...manual];
    courseRowsList.forEach(row =>
      row.coachCells.forEach(cell => {
        const fixed = normalizeCoachCellText(cell.text, roster, input.aliases);
        if (fixed !== cell.text) {
          cell.text = fixed;
          writes.set(cell.key, fixed);
        }
      }),
    );
    const dutyRowCountByRole = {} as Record<DutyRole, number>;
    const dutyCells = {} as Record<DutyRole, DutyCell[]>;
    (['frontdesk', 'lifeguard'] as const).forEach(role => {
      const count = dutyRowCount(draft, dutyGridRowsKey(week.no, venue.name, role));
      dutyRowCountByRole[role] = count;
      dutyCells[role] = Array.from({ length: count }, (_, i) =>
        dates.map(date => {
          const key = dutyGridCellKey(week.no, venue.name, role, i + 1, date.dayNo);
          return { venue, role, row: i + 1, date, key, text: normalizeCellText(read(key)) };
        }),
      ).flat();
    });
    return { venue, dutyCells, dutyRowCount: dutyRowCountByRole, courseRows: courseRowsList };
  });

  return { week, dates, ctx, draft, venues, derivedCells: writes };
}

export function applyDerivedCells(draft: Draft, derived: ReadonlyMap<string, string | null>): Draft {
  const cells = new Map(draft.cells);
  derived.forEach((value, key) => {
    if (value === null) cells.delete(key);
    else cells.set(key, value);
  });
  return { cells, meta: draft.meta };
}

export function renderedCellKeys(model: WeekModel): string[] {
  return model.venues.flatMap(({ venue, dutyCells, courseRows }) => [
    ...dutyCells.frontdesk.map(c => c.key),
    ...dutyCells.lifeguard.map(c => c.key),
    ...courseRows.flatMap(row =>
      row.kind === 'manual'
        ? [manualCellKey(model.week.no, venue.name, row.course.id, 'name'), row.enrollKey, row.neededKey, ...row.coachCells.map(c => c.key), row.noteKey]
        : [row.enrollKey, row.neededKey, ...row.coachCells.map(c => c.key), row.noteKey],
    ),
  ]);
}

export interface EnrollCellView {
  className: '' | 'api' | 'empty' | 'manual' | 'loading';
  title: string;
}

const ENROLL_VIEW: Record<Exclude<EnrollDisplay['kind'], 'closed'>, EnrollCellView> = {
  loading: { className: 'loading', title: '點擊可輸入手動人數；雙擊重置回系統值' },
  unavailable: { className: 'empty', title: 'API 未連線，暫無報名人數資料；點擊可手動輸入' },
  override: { className: 'manual', title: '雙擊可重置回系統值' },
  system: { className: 'api', title: '由 /api/schedule/enrollment-counts 帶入；點擊可手動覆蓋；雙擊重置' },
};

export function enrollCellView(enroll: EnrollDisplay): EnrollCellView {
  if (enroll.kind === 'closed') return { className: '', title: enroll.reason ? `關班原因：${enroll.reason}` : '此時段已關班' };
  return ENROLL_VIEW[enroll.kind];
}

const PERIOD_PLACEHOLDER: Record<'weekday' | 'sat' | 'sun', string> = { weekday: '平日教練，請選擇員工 123', sat: '週六教練', sun: '週日教練' };

export function coachPlaceholder(row: CourseRow, cell: CoachCell): string {
  if (row.kind === 'manual') return '選擇教練';
  if (row.zeroEnroll && cell.text.trim() === '') return '0人，無需排教練';
  return PERIOD_PLACEHOLDER[cell.period as 'weekday' | 'sat' | 'sun'];
}
