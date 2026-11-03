import { FRONTDESK_RULE } from './config';
import { dayName, formatManualDate as formatDateLabel } from './dates';
import {
  activeDaysForPeriod,
  countAssignmentsByDay,
  countDistinctAssignees,
  dutyPeriodForDay,
  duplicateNames,
  parseAssignments,
  parseDutyGridLines,
  timesOverlap,
  usefulLines,
} from './parse';
import type { CellKey, DayNo, DutyRole, EmployeeId, TimeRange, VenueConfig } from './types';
import type { AvailabilityInterval } from './availability';
import type { CourseRow, DutyCell, WeekModel } from './week-model';

export type Tone = 'ok' | 'warn' | 'none';

export interface CellStatus {
  tone: Tone;
  text: string;
  conflict: boolean;
}

export type IssueType = 'critical' | 'shortage' | 'notice';

export interface Issue {
  venue: string;
  cells: string;
  text: string;
  type: IssueType;
}

export function neededNumber(text: string): number | null {
  const n = parseInt(String(text || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function enrollNumber(text: string): number | null {
  const n = parseInt(String(text || '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function venueRule(venue: VenueConfig, role: DutyRole): { min: number; max: number; label: string } {
  return role === 'frontdesk' ? { ...FRONTDESK_RULE, label: '櫃台' } : { min: venue.lifeguardMin, max: venue.lifeguardMax, label: '救生' };
}

function courseCellStatus(model: WeekModel, row: CourseRow, cell: CourseRow['coachCells'][number]): CellStatus {
  const status = (tone: Tone, text: string): CellStatus => ({ tone, text, conflict: false });
  const needed = neededNumber(row.neededText);
  const enroll = enrollNumber(row.enrollText);
  const text = cell.text.trim();
  const assignments = parseAssignments(model.ctx, text, cell.period, model.week, cell.key);
  const dups = duplicateNames(assignments);
  if (dups.length) return status('warn', `人員重複：${dups.join('、')}`);
  if (enroll === 0) return status('ok', '報名 0 人｜教練 0');
  if (!needed) return status('none', '請先填需教練數');
  if (!text) return status('warn', `教練不足：0/${needed}`);
  if (cell.period === 'sat' || cell.period === 'sun') {
    const count = countDistinctAssignees(assignments);
    if (count < needed) return status('warn', `教練不足：${count}/${needed}`);
    if (count > needed) return status('warn', `教練超過：${count}/${needed}`);
    return status('ok', `OK｜${count}人`);
  }
  const counts = countAssignmentsByDay(assignments, activeDaysForPeriod(cell.period, model.week));
  const bad: string[] = [];
  counts.forEach((count, day) => {
    if (count < needed) bad.push(`${dayName(day)}不足${count}/${needed}`);
    if (count > needed) bad.push(`${dayName(day)}超過${count}/${needed}`);
  });
  if (bad.length) return status('warn', bad.join('、'));
  return status('ok', `OK｜${Array.from(counts, ([d, c]) => `${dayName(d)}:${c}`).join(' ')}`);
}

function dutyCellStatus(model: WeekModel, cell: DutyCell): CellStatus {
  const text = cell.text.trim();
  if (!text) return { tone: 'none', text: '', conflict: false };
  const total = usefulLines(text).length;
  const parsed = parseDutyGridLines(model.ctx, text, cell.role, cell.date.dayNo, cell.key).length;
  return parsed < total
    ? { tone: 'warn', text: `有 ${total - parsed} 筆未讀到時間`, conflict: false }
    : { tone: 'ok', text: `已讀取 ${parsed} 筆`, conflict: false };
}

export interface WorkEntry {
  roleType: 'course' | DutyRole;
  cellKey: CellKey;
  rowKey: string;
  venue: string;
  name: string;
  employeeId: EmployeeId | '';
  days: DayNo[];
  time: TimeRange;
  courseName: string;
  slotCode: string;
}

export function workEntries(model: WeekModel): WorkEntry[] {
  const courses: WorkEntry[] = [];
  const duty: Record<DutyRole, WorkEntry[]> = { lifeguard: [], frontdesk: [] };
  model.venues.forEach(({ venue, courseRows, dutyCells }) => {
    courseRows.forEach(row => {
      if (!row.time) return;
      const time = row.time;
      row.coachCells.forEach(cell =>
        parseAssignments(model.ctx, cell.text, cell.period, model.week, cell.key).forEach(a =>
          courses.push({
            roleType: 'course',
            cellKey: cell.key,
            rowKey: `${row.rowId}|${cell.period}|${cell.key}`,
            venue: venue.name,
            name: a.name,
            employeeId: a.employeeId,
            days: a.days,
            time,
            courseName: row.courseName,
            slotCode: row.slotCode,
          }),
        ),
      );
    });
    (['lifeguard', 'frontdesk'] as const).forEach(role =>
      dutyCells[role].forEach(cell =>
        parseDutyGridLines(model.ctx, cell.text, role, cell.date.dayNo, cell.key).forEach(a =>
          duty[role].push({
            roleType: role,
            cellKey: cell.key,
            rowKey: `${role}|${cell.key}|${dutyPeriodForDay(cell.date.dayNo)}|${venue.name}|${a.raw}`,
            venue: venue.name,
            name: a.name,
            employeeId: a.employeeId,
            days: [a.dayNo],
            time: a.time,
            courseName: '',
            slotCode: '',
          }),
        ),
      ),
    );
  });
  return [...courses, ...duty.lifeguard, ...duty.frontdesk];
}

export function workTypeLabel(x: Pick<WorkEntry, 'roleType' | 'courseName' | 'slotCode'>): string {
  if (x.roleType === 'course') return `課程 ${x.courseName || ''} ${x.slotCode || ''}`.trim();
  return x.roleType === 'lifeguard' ? '救生' : '櫃台';
}

export function workLabel(w: Pick<WorkEntry, 'roleType' | 'courseName' | 'slotCode' | 'venue' | 'time'>): string {
  return [w.venue, workTypeLabel(w), w.time.label].filter(Boolean).join(' ') || w.time.label || '工作';
}

function samePerson(a: { employeeId: EmployeeId | ''; name: string }, b: { employeeId: EmployeeId | ''; name: string }): boolean {
  if (a.employeeId && b.employeeId) return String(a.employeeId) === String(b.employeeId);
  return !!(a.name && b.name && a.name === b.name);
}

function addConflict(statuses: Map<string, CellStatus>, key: string, msg: string) {
  const prev = statuses.get(key) ?? { tone: 'none' as Tone, text: '', conflict: false };
  const prevText = prev.text.trim();
  if (prevText.includes(msg)) {
    statuses.set(key, { ...prev, tone: 'warn' });
    return;
  }
  statuses.set(key, { tone: 'warn', text: prevText ? `${prevText}｜${msg}` : msg, conflict: true });
}

function applyWorkConflicts(statuses: Map<string, CellStatus>, entries: readonly WorkEntry[]) {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.rowKey === b.rowKey || !samePerson(a, b) || !timesOverlap(a.time, b.time)) continue;
      const sameDays = a.days.filter(d => b.days.includes(d));
      if (!sameDays.length) continue;
      const dLabel = sameDays.map(d => dayName(d)).join('、');
      addConflict(statuses, a.cellKey, `撞班：${a.name} 同時排到「${workLabel(b)}」（週${dLabel}）`);
      addConflict(statuses, b.cellKey, `撞班：${b.name} 同時排到「${workLabel(a)}」（週${dLabel}）`);
    }
  }
}

export function venueTextMatches(availVenues: string, venue: string): boolean {
  const v = String(availVenues || '全部');
  return v.includes('全部') || v.includes(venue);
}

function applyAvailabilityConflicts(statuses: Map<string, CellStatus>, entries: readonly WorkEntry[], avails: readonly AvailabilityInterval[]) {
  if (!avails.length) return;
  entries.forEach(work => {
    if (!work.name && !work.employeeId) return;
    if (!avails.some(a => samePerson(a, work))) return;
    work.days.forEach(day => {
      const ok = avails.some(
        a => samePerson(a, work) && Number(a.day) === Number(day) && a.time.start <= work.time.start && a.time.end >= work.time.end && venueTextMatches(a.venues || '全部', work.venue || ''),
      );
      if (!ok) addConflict(statuses, work.cellKey, `不在可排班時段：${work.name} 週${dayName(day)} ${work.time.label}`);
    });
  });
}

export function classifyIssue(text: string): IssueType {
  const t = String(text || '');
  if (/撞班|撞課|不在可排班時段|同時|超過|重複/.test(t)) return 'critical';
  if (/不足|未填|請先填|格式錯誤|無救生|無櫃台/.test(t)) return 'shortage';
  return 'notice';
}

export const ISSUE_GROUPS: readonly { type: IssueType; label: string; hint: string }[] = [
  { type: 'critical', label: '嚴重錯誤', hint: '必須優先處理' },
  { type: 'shortage', label: '排班不足', hint: '需補人或確認' },
  { type: 'notice', label: '提醒', hint: '可檢查後處理' },
];

export interface WeekValidation {
  statuses: ReadonlyMap<string, CellStatus>;
  issueRows: ReadonlySet<string>;
  issues: Issue[];
}

const firstLine = (s: string) => s.trim().split('\n')[0];

export function validateWeek(model: WeekModel, avails: readonly AvailabilityInterval[] = []): WeekValidation {
  const statuses = new Map<string, CellStatus>();
  model.venues.forEach(({ courseRows, dutyCells }) => {
    (['frontdesk', 'lifeguard'] as const).forEach(role => dutyCells[role].forEach(cell => statuses.set(cell.key, dutyCellStatus(model, cell))));
    courseRows.forEach(row => row.coachCells.forEach(cell => statuses.set(cell.key, courseCellStatus(model, row, cell))));
  });
  const entries = workEntries(model);
  applyWorkConflicts(statuses, entries);
  applyAvailabilityConflicts(statuses, entries, avails);

  const issueRows = new Set<string>();
  const issues: Issue[] = [];
  const push = (venue: VenueConfig, cells: string[], rowId: string, keys: readonly string[]) => {
    keys.forEach(key => {
      const s = statuses.get(key);
      if (s?.tone !== 'warn') return;
      issueRows.add(rowId);
      const text = s.text.trim();
      if (text) issues.push({ venue: venue.name, cells: cells.filter(Boolean).join('｜'), text, type: classifyIssue(text) });
    });
  };
  model.venues.forEach(({ venue, dutyCells, dutyRowCount, courseRows }) => {
    (['frontdesk', 'lifeguard'] as const).forEach(role => {
      for (let r = 1; r <= dutyRowCount[role]; r++) {
        const rowCells = dutyCells[role].filter(c => c.row === r);
        const label = [String(r), ...rowCells.slice(0, 2).map(c => firstLine(c.text))];
        push(venue, label, `${venue.name}|${role}|r${r}`, rowCells.map(c => c.key));
      }
    });
    courseRows.forEach(row => {
      const label = row.kind === 'manual' ? [formatDateLabel(row.course.date), row.courseName, row.timeLabel] : [row.courseName, row.slotCode, row.timeLabel];
      push(venue, label.map(firstLine), `${venue.name}|${row.rowId}`, row.coachCells.map(c => c.key));
    });
  });
  const seen = new Set<string>();
  return {
    statuses,
    issueRows,
    issues: issues.filter(i => {
      const k = i.venue + i.cells + i.text;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  };
}

export interface IssueGroup {
  type: IssueType;
  label: string;
  hint: string;
  total: number;
  items: Issue[];
}

export function groupIssues(issues: readonly Issue[], limit: number): IssueGroup[] {
  return ISSUE_GROUPS.map(g => {
    const all = issues.filter(i => i.type === g.type);
    return { ...g, total: all.length, items: all.slice(0, limit) };
  }).filter(g => g.total > 0);
}
