import { isScheduleValueKey } from './cell-key';
import { isoDateForWeekDay } from './dates';
import { dutyPeriodForDay, minutesToTime, parseAssignments, parseDutyGridLines, venueIdByName } from './parse';
import type { ResolvedEmployee } from './roster';
import type {
  CellKey,
  CourseAssignment,
  Draft,
  DutyAssignment,
  DutyRole,
  EmployeeId,
  EmployeeMeta,
  NormalizedAssignment,
  PortalShiftRow,
  RawEntry,
  SaveSchedulePayload,
  TimeRange,
  WeekConfig,
} from './types';
import type { WeekModel } from './week-model';

interface ParsedPerson {
  name: string;
  rawName?: string;
  employeeId: EmployeeId | '';
  lineBound: boolean;
  role: string;
}

function employeeForAssignment(model: WeekModel, a: ParsedPerson): Pick<ResolvedEmployee, 'name' | 'role' | 'lineBound'> & { id: EmployeeId | '' } {
  const { roster } = model.ctx;
  if (a.employeeId) {
    const emp = roster.byId(a.employeeId);
    if (emp) return emp;
  }
  return roster.byName(a.name) ?? { id: a.employeeId || '', name: a.name || '未指定員工', role: a.role || '', lineBound: !!a.lineBound };
}

function base(model: WeekModel, venueName: string, venueId: string, time: TimeRange, a: ParsedPerson) {
  const emp = employeeForAssignment(model, a);
  return {
    weekNo: model.week.no,
    venueId: venueId || String(venueIdByName(venueName) || ''),
    venueName: venueName || '',
    courseId: '' as const,
    slotId: '' as const,
    startTime: minutesToTime(time.start),
    endTime: minutesToTime(time.end),
    employeeId: emp.id || '',
    employeeName: emp.name || a.name || '未指定員工',
    role: emp.role || a.role || '',
    lineBound: !!emp.lineBound,
    rawName: a.rawName || a.name || '',
  };
}

export interface KeyedAssignment {
  cellKey: CellKey;
  assignment: NormalizedAssignment;
}

function courseAssignments(model: WeekModel): KeyedAssignment[] {
  const out: KeyedAssignment[] = [];
  model.venues.forEach(({ venue, courseRows }) =>
    courseRows.forEach(row => {
      if (!row.time) return;
      const time = row.time;
      const venueId = row.kind === 'manual' ? String(row.course.venueId || venueIdByName(venue.name)) : String(venue.venueId || venueIdByName(venue.name) || '');
      row.coachCells.forEach(cell =>
        parseAssignments(model.ctx, cell.text, cell.period, model.week, cell.key).forEach(a => {
          const b = base(model, venue.name, venueId, time, a);
          const assignment: CourseAssignment = {
            weekNo: b.weekNo,
            venueId: b.venueId,
            venueName: b.venueName,
            roleType: 'course',
            courseId: '',
            courseName: row.courseName,
            slotId: '',
            slotCode: row.slotCode,
            dateType: cell.period,
            days: a.days,
            startTime: b.startTime,
            endTime: b.endTime,
            employeeId: b.employeeId,
            employeeName: b.employeeName,
            role: b.role,
            lineBound: b.lineBound,
            source: row.kind === 'manual' ? 'manual' : 'registration',
            coachRole: a.coachRole,
            rawName: b.rawName,
            follow: a.follow,
            requiredCoaches: row.neededText.trim(),
            registeredCount: row.enrollText.trim(),
            manualCourseId: row.kind === 'manual' ? String(row.course.id) : '',
            date: row.kind === 'manual' ? row.course.date : '',
          };
          out.push({ cellKey: cell.key, assignment });
        }),
      );
    }),
  );
  return out;
}

function dutyAssignments(model: WeekModel, role: DutyRole): KeyedAssignment[] {
  const out: KeyedAssignment[] = [];
  model.venues.forEach(({ venue, dutyCells }) => {
    const venueId = String(venue.venueId || venueIdByName(venue.name) || '');
    dutyCells[role].forEach(cell =>
      parseDutyGridLines(model.ctx, cell.text, role, cell.date.dayNo, cell.key).forEach(a => {
        const b = base(model, venue.name, venueId, a.time, a);
        const assignment: DutyAssignment = {
          weekNo: b.weekNo,
          venueId: b.venueId,
          venueName: b.venueName,
          roleType: role,
          courseId: '',
          courseName: '',
          slotId: '',
          slotCode: '',
          dateType: dutyPeriodForDay(cell.date.dayNo),
          days: [a.dayNo],
          startTime: b.startTime,
          endTime: b.endTime,
          employeeId: b.employeeId,
          employeeName: b.employeeName,
          role: b.role,
          lineBound: b.lineBound,
          source: 'schedule',
          coachRole: '',
          rawName: b.rawName,
          follow: false,
        };
        out.push({ cellKey: cell.key, assignment });
      }),
    );
  });
  return out;
}

export function collectKeyedAssignments(model: WeekModel): KeyedAssignment[] {
  return [...courseAssignments(model), ...dutyAssignments(model, 'frontdesk'), ...dutyAssignments(model, 'lifeguard')];
}

export function collectAssignments(model: WeekModel): NormalizedAssignment[] {
  return collectKeyedAssignments(model).map(k => k.assignment);
}

const SHIFT_ROLE = { lifeguard: '救生', frontdesk: '櫃台', course: '教練' } as const;

export function notesForShift(a: NormalizedAssignment): string {
  const parts: string[] = [];
  if (a.roleType === 'course') parts.push(a.source === 'manual' ? '手動課程' : '暑假課程');
  else parts.push(a.roleType === 'lifeguard' ? '暑假救生排班' : '暑假櫃台排班');
  if (a.courseName) parts.push(a.courseName);
  if (a.slotCode) parts.push(a.slotCode);
  if (a.roleType === 'course') {
    if (a.registeredCount !== '') parts.push(`報名 ${a.registeredCount} 人`);
    if (a.requiredCoaches !== '') parts.push(`需求 ${a.requiredCoaches} 位`);
    if (a.manualCourseId) parts.push(`manualCourseId:${a.manualCourseId}`);
  }
  return parts.filter(Boolean).join('｜') || '暑假排班';
}

export function collectShiftRows(assignments: readonly NormalizedAssignment[], week: WeekConfig): PortalShiftRow[] {
  const rows: PortalShiftRow[] = [];
  assignments.forEach(a => {
    if (!a.employeeId || !a.venueId || !a.startTime || !a.endTime) return;
    const dates: string[] = [];
    if (a.roleType === 'course' && a.date) dates.push(a.date);
    else
      a.days.forEach(day => {
        const iso = isoDateForWeekDay(week, day);
        if (iso) dates.push(iso);
      });
    Array.from(new Set(dates)).forEach(date =>
      rows.push({
        employeeId: Number(a.employeeId),
        venueId: Number(a.venueId),
        date,
        startTime: a.startTime,
        endTime: a.endTime,
        role: SHIFT_ROLE[a.roleType],
        notes: notesForShift(a),
        status: 'active',
        source: 'summer-schedule-v40',
        weekNo: a.weekNo,
        roleType: a.roleType,
        courseName: a.courseName || '',
        slotCode: a.slotCode || '',
        manualCourseId: a.roleType === 'course' ? a.manualCourseId || '' : '',
        originalAssignment: a,
      }),
    );
  });
  return rows.sort(
    (x, y) => String(x.date).localeCompare(String(y.date)) || String(x.startTime).localeCompare(String(y.startTime)) || String(x.employeeId).localeCompare(String(y.employeeId)),
  );
}

export function rawEntriesFromDraft(draft: Draft): RawEntry[] {
  const out: RawEntry[] = [];
  const seen = new Set<string>();
  draft.cells.forEach((value, key) => {
    seen.add(key);
    out.push({ key, value, employees: [...(draft.meta.get(key) ?? [])] });
  });
  draft.meta.forEach((employees, key) => {
    if (!seen.has(key)) out.push({ key, value: '', employees: [...employees] });
  });
  return out;
}

export function buildSavePayload(model: WeekModel, draft: Draft, generatedAt: Date): SaveSchedulePayload {
  const assignments = collectAssignments(model);
  return {
    version: 'v40',
    weekNo: model.week.no,
    generatedAt: generatedAt.toISOString(),
    rawEntries: rawEntriesFromDraft(draft),
    assignments,
    shifts: collectShiftRows(assignments, model.week),
  };
}

export function rawEntryHasScheduleValue(entry: RawEntry): boolean {
  const value = String(entry.value || '').trim();
  if (!value && !entry.employees.length) return false;
  return isScheduleValueKey(String(entry.key || ''));
}

export interface ServerDraftShape {
  rawEntries?: readonly RawEntry[];
  assignments?: readonly unknown[];
  shifts?: readonly unknown[];
  shiftEntries?: readonly unknown[];
}

export function hasShiftRows(p: ServerDraftShape): boolean {
  return !!((p.shifts ?? []).length || (p.shiftEntries ?? []).length);
}

export function hasWorkRows(p: ServerDraftShape): boolean {
  return !!((p.assignments ?? []).length || hasShiftRows(p));
}

export function hasScheduleValue(p: ServerDraftShape): boolean {
  if ((p.assignments ?? []).length || (p.shifts ?? []).length) return true;
  return (p.rawEntries ?? []).some(rawEntryHasScheduleValue);
}

export function blocksEmptySave(server: ServerDraftShape, payload: ServerDraftShape): boolean {
  return (hasShiftRows(server) && !hasShiftRows(payload)) || (hasWorkRows(server) && !hasWorkRows(payload)) || (hasScheduleValue(server) && !hasScheduleValue(payload));
}

export function draftFromRawEntries(entries: readonly { key?: unknown; value?: unknown; employees?: unknown }[]): Draft {
  const cells = new Map<string, string>();
  const meta = new Map<string, EmployeeMeta[]>();
  entries.forEach(entry => {
    if (!entry.key || typeof entry.key !== 'string') return;
    cells.set(entry.key, entry.value ? String(entry.value) : '');
    if (Array.isArray(entry.employees)) meta.set(entry.key, entry.employees as EmployeeMeta[]);
  });
  return { cells, meta };
}
