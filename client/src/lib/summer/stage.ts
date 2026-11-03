import { dutyGridCellKey, dutyGridRowsKey } from './cell-key';
import { VENUES } from './config';
import { datesInWeek, dayNoOf, isIsoDate, type WeekDate } from './dates';
import { compactTimeLabel, dutyPeriodForDay, minutesToTime, parseAssignments, parseDutyGridLines, parseTimeRange } from './parse';
import type { CellKey, DayNo, DutyPeriod, DutyRole, EmployeeId, VenueConfig, VenueName, WeekConfig } from './types';
import { venueRule } from './validate';
import { dutyRowCount, type RegistrationCourseRow, type WeekModel } from './week-model';

export const AXIS_START = 330;
export const AXIS_END = 1350;
const AXIS_WIDTH = AXIS_END - AXIS_START;

export const axisPct = (m: number) => ((m - AXIS_START) / AXIS_WIDTH) * 100;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const fmtMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export function fmtHours(a: number, b: number): string {
  const h = (b - a) / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

export function rulerTicks(): { label: string; pct: number; edge: boolean; noon: boolean }[] {
  const ticks = [{ label: '05:30', pct: 0, edge: true, noon: false }];
  for (let h = 8; h <= 22; h += 2) ticks.push({ label: `${String(h).padStart(2, '0')}:00`, pct: axisPct(h * 60), edge: false, noon: h === 12 });
  return ticks;
}

export type StageView = 'timeline' | 'matrix' | 'courses';
export type StageDay = 'weekday' | 'sat' | 'sun' | `${DayNo}`;

export function stageView(view: string): StageView {
  return view === 'matrix' || view === 'courses' ? view : 'timeline';
}

export function stageVenue(venueFilter: string): VenueConfig {
  return VENUES.find(v => v.name === venueFilter) ?? VENUES[0];
}

export function selectedDayNo(week: WeekConfig, day: StageDay): DayNo {
  const opts = datesInWeek(week);
  const n = Number(day);
  const hit = opts.find(d => d.dayNo === n);
  if (hit) return hit.dayNo;
  if (day === 'sat' && opts.some(d => d.dayNo === 6)) return 6;
  if (day === 'sun' && opts.some(d => d.dayNo === 7)) return 7;
  if (day === 'weekday') {
    const first = week.activeWeekdays.find(d => opts.some(x => x.dayNo === d));
    if (first) return first;
  }
  return opts[0]?.dayNo ?? 1;
}

const PERIOD_LABEL: Record<DutyPeriod, string> = { weekday: '平日', sat: '週六', sun: '週日' };

export function selectedDayLabel(week: WeekConfig, dayNo: DayNo): string {
  const d = datesInWeek(week).find(x => x.dayNo === dayNo);
  return d ? `${d.label} ${d.weekday}` : PERIOD_LABEL[dutyPeriodForDay(dayNo)];
}

export interface DutySeg {
  no: string;
  label: string;
  a: number;
  b: number;
}

export function dutySegs(venue: VenueConfig): DutySeg[] {
  return venue.duty.map(([no, t]) => {
    const r = parseTimeRange(t) ?? { start: 0, end: 0 };
    return { no, label: t, a: r.start, b: r.end };
  });
}

export interface PublishedDutyShift {
  id: number | string;
  venueId: number | string;
  roleKind: string;
  date: string;
  startTime: string;
  endTime: string;
  employeeName: string;
  employeeId: EmployeeId;
}

export type StageShift =
  | { source: 'published'; name: string; a: number; b: number; employeeId: EmployeeId; lineBound: true; raw: string; id: number | string }
  | { source: 'draft'; name: string; a: number; b: number; employeeId: EmployeeId | ''; lineBound: boolean; raw: string; key: CellKey };

const hm = (t: string) => {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
};
const byStartThenName = (x: StageShift, y: StageShift) => x.a - y.a || String(x.name).localeCompare(String(y.name), 'zh-Hant');

export function stageShifts(model: WeekModel, venue: VenueConfig, role: DutyRole, dayNo: DayNo, published: readonly PublishedDutyShift[]): StageShift[] {
  const fromServer: StageShift[] = published
    .filter(s => {
      const iso = String(s.date).slice(0, 10);
      return Number(s.venueId) === Number(venue.venueId) && s.roleKind === role && isIsoDate(iso) && dayNoOf(iso) === dayNo;
    })
    .map(s => ({
      source: 'published',
      name: s.employeeName,
      a: hm(s.startTime),
      b: hm(s.endTime),
      employeeId: s.employeeId,
      lineBound: true,
      raw: `${s.employeeName} ${(s.startTime || '').slice(0, 5)}-${(s.endTime || '').slice(0, 5)}`,
      id: s.id,
    }));
  if (fromServer.length) return fromServer.sort(byStartThenName);
  const cells = model.venues.find(v => v.venue.name === venue.name)?.dutyCells[role] ?? [];
  return cells
    .filter(c => c.date.dayNo === dayNo)
    .flatMap(c =>
      parseDutyGridLines(model.ctx, c.text, role, c.date.dayNo, c.key).map(
        (s): StageShift => ({ source: 'draft', name: s.name, a: s.time.start, b: s.time.end, employeeId: s.employeeId, lineBound: s.lineBound, raw: s.raw, key: c.key }),
      ),
    )
    .sort(byStartThenName);
}

export type CoverageState = 'ok' | 'under' | 'empty' | 'over';

export function coverageState(count: number, rule: { min: number; max: number }): CoverageState {
  if (count === 0) return 'empty';
  if (count < rule.min) return 'under';
  if (count > rule.max) return 'over';
  return 'ok';
}

export interface Coverage {
  count: number;
  state: CoverageState;
  names: string[];
}

export function onDutyAt(list: readonly StageShift[], minute: number): { count: number; names: string[] } {
  const on = list.filter(s => s.a <= minute && minute < s.b);
  return { count: on.length, names: on.map(s => s.name) };
}

export function segCoverage(list: readonly StageShift[], seg: { a: number; b: number }, rule: { min: number; max: number }): Coverage {
  let worst = Infinity;
  let names: string[] = [];
  for (let m = seg.a; m < seg.b; m += 15) {
    const r = onDutyAt(list, m);
    if (r.count < worst) {
      worst = r.count;
      names = r.names;
    }
  }
  if (worst === Infinity) worst = 0;
  return { count: worst, state: coverageState(worst, rule), names };
}

export function segMembers(list: readonly StageShift[], seg: { a: number; b: number }): StageShift[] {
  const seen = new Set<string>();
  return list
    .filter(s => {
      if (!(s.a < seg.b && s.b > seg.a)) return false;
      const id = [s.source === 'draft' ? s.key : `published-${s.id}`, s.raw, s.name, s.a, s.b].join('|');
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort(byStartThenName);
}

export function roleGapCount(list: readonly StageShift[], venue: VenueConfig, role: DutyRole): number {
  const rule = venueRule(venue, role);
  return dutySegs(venue).filter(seg => {
    const state = segCoverage(list, seg, rule).state;
    return state === 'empty' || state === 'under';
  }).length;
}

export interface StageContext {
  model: WeekModel;
  dayNo: DayNo;
  published: readonly PublishedDutyShift[];
}

export const shiftsFor = (c: StageContext, venue: VenueConfig, role: DutyRole) => stageShifts(c.model, venue, role, c.dayNo, c.published);

export function venueGapCount(c: StageContext, venue: VenueConfig): number {
  return roleGapCount(shiftsFor(c, venue, 'lifeguard'), venue, 'lifeguard') + roleGapCount(shiftsFor(c, venue, 'frontdesk'), venue, 'frontdesk');
}

export interface StageCourse {
  code: string;
  courseName: string;
  a: number;
  b: number;
  label: string;
  id: string;
  enrolled: number;
  need: number;
  coaches: string[];
}

export function stageCourses(c: StageContext, venue: VenueConfig): StageCourse[] {
  const period = dutyPeriodForDay(c.dayNo);
  const rows = (c.model.venues.find(v => v.venue.name === venue.name)?.courseRows ?? []).filter(
    (r): r is RegistrationCourseRow => r.kind === (period === 'weekday' ? 'weekday' : 'holiday'),
  );
  return rows.map(r => {
    const enrolled = parseInt(r.enrollText.trim(), 10);
    const need = parseInt(r.neededText.trim(), 10);
    const cell = r.coachCells.find(x => x.period === period);
    const coaches = cell ? parseAssignments(c.model.ctx, cell.text, period, c.model.week).filter(a => a.days.includes(c.dayNo)).map(a => a.name) : [];
    return {
      code: r.slotCode,
      courseName: r.courseName,
      a: r.time?.start ?? 0,
      b: r.time?.end ?? 0,
      label: r.timeLabel,
      id: r.rowId,
      enrolled: Number.isFinite(enrolled) ? enrolled : 0,
      need: Number.isFinite(need) ? need : 0,
      coaches,
    };
  });
}

export type CourseState = 'none' | 'under' | 'empty' | 'ok';

export function courseState(c: StageCourse): CourseState {
  if (c.enrolled === 0) return 'none';
  if (!(c.need > 0)) return 'under';
  if (c.coaches.length === 0) return 'empty';
  if (c.coaches.length < c.need) return 'under';
  return 'ok';
}

export interface CourseSummary {
  active: number;
  needUnset: number;
  missing: number;
}

export function courseSummary(list: readonly StageCourse[]): CourseSummary {
  return list.reduce(
    (acc, c) => {
      if (c.enrolled > 0) {
        acc.active++;
        if (!(c.need > 0)) acc.needUnset++;
        else acc.missing += Math.max(c.need - c.coaches.length, 0);
      }
      return acc;
    },
    { active: 0, needUnset: 0, missing: 0 },
  );
}

export function courseSummaryText(sum: CourseSummary): string {
  if (sum.needUnset > 0) return `需求未設定 ${sum.needUnset} 門`;
  if (sum.missing > 0) return `缺 ${sum.missing} 位教練`;
  if (sum.active > 0) return '教練已配齊';
  return '無需排教練';
}

export const courseSummaryNeedsWork = (sum: CourseSummary) => sum.needUnset > 0 || sum.missing > 0;
export const courseMissCount = (c: StageContext, venue: VenueConfig) => {
  const s = courseSummary(stageCourses(c, venue));
  return s.needUnset + s.missing;
};

export const STATE_LABEL: Record<CoverageState | 'closed' | 'none', string> = { ok: '達標', under: '不足', empty: '未排', over: '超量', closed: '未營運', none: '免排' };
const GLYPH: Record<CoverageState, string> = { empty: '✕', under: '▾', over: '▴', ok: '✓' };

export interface TimelineBar {
  left: number;
  width: number;
  label: string;
  hours: string;
  tip: string;
  removable: { key: CellKey; raw: string } | null;
}

export interface CoverageChip {
  seg: DutySeg;
  left: number;
  width: number;
  coverage: Coverage;
  glyph: string;
  gap: boolean;
  tip: string;
}

export interface RoleLane {
  role: DutyRole;
  needText: string;
  gaps: number;
  statusText: string;
  rows: { name: string; bars: TimelineBar[] }[];
  chips: CoverageChip[];
}

const ROLE_LABEL: Record<DutyRole, string> = { lifeguard: '救生', frontdesk: '櫃台' };

export function roleLane(c: StageContext, venue: VenueConfig, role: DutyRole): RoleLane {
  const rule = venueRule(venue, role);
  const list = shiftsFor(c, venue, role);
  const names: string[] = [];
  const byName = new Map<string, StageShift[]>();
  list.forEach(s => {
    if (!byName.has(s.name)) {
      byName.set(s.name, []);
      names.push(s.name);
    }
    byName.get(s.name)!.push(s);
  });
  const gaps = roleGapCount(list, venue, role);
  return {
    role,
    needText: `需 ${rule.min}–${rule.max} 人`,
    gaps,
    statusText: gaps === 0 ? '全時段達標' : `${gaps} 個缺口`,
    rows: names.map(name => ({
      name,
      bars: byName.get(name)!.map(s => {
        const left = clamp(axisPct(s.a), 0, 100);
        const span = `${fmtMinutes(s.a)}–${fmtMinutes(s.b)}`;
        return {
          left,
          width: Math.max(clamp(axisPct(s.b), 0, 100) - left, 0),
          label: span,
          hours: fmtHours(s.a, s.b),
          tip:
            s.source === 'published'
              ? `${name}　${span}　${fmtHours(s.a, s.b)}（已發布班次）`
              : `${name}　${span}　${fmtHours(s.a, s.b)}${s.lineBound ? '' : '（未綁定LINE）'}　▸ 按 ✕ 移除`,
          removable: s.source === 'draft' ? { key: s.key, raw: s.raw } : null,
        };
      }),
    })),
    chips: dutySegs(venue).map(seg => {
      const coverage = segCoverage(list, seg, rule);
      const gap = coverage.state === 'empty' || coverage.state === 'under';
      return {
        seg,
        left: axisPct(seg.a),
        width: axisPct(seg.b) - axisPct(seg.a),
        coverage,
        glyph: GLYPH[coverage.state],
        gap,
        tip: `${seg.label}　在班 ${coverage.count} 人（需 ${rule.min}–${rule.max}）　${STATE_LABEL[coverage.state]}${coverage.names.length ? '｜' + coverage.names.join('、') : ''}　▸ 點此排班`,
      };
    }),
  };
}

export interface CourseBar {
  course: StageCourse;
  state: CourseState;
  left: number;
  width: number;
  coachesText: string;
  tail: string;
  tip: string;
}

export function coursePill(c: StageCourse): string {
  const state = courseState(c);
  if (state === 'none') return '免排';
  if (!(c.need > 0)) return '需求未設定';
  if (state === 'under') return `缺${Math.max(c.need - c.coaches.length, 0)}`;
  return STATE_LABEL[state];
}

export function courseLane(c: StageContext, venue: VenueConfig): { headText: string; summary: CourseSummary; summaryText: string; bars: CourseBar[] } {
  const list = stageCourses(c, venue);
  const summary = courseSummary(list);
  return {
    headText: `${dutyPeriodForDay(c.dayNo) === 'weekday' ? '平日課' : '假日課'} ${list.length} 門`,
    summary,
    summaryText: courseSummaryText(summary),
    bars: list.map(course => {
      const state = courseState(course);
      const left = clamp(axisPct(course.a), 0, 100);
      const lack = Math.max(course.need - course.coaches.length, 0);
      const tail = state === 'none' ? '免排' : !(course.need > 0) ? '未填需求' : state === 'empty' ? `缺${course.need}` : state === 'under' ? `缺${lack}` : '';
      return {
        course,
        state,
        left,
        width: Math.max(clamp(axisPct(course.b), 0, 100) - left, 0),
        coachesText: course.coaches.join('·'),
        tail,
        tip: `課程 ${course.code}　${course.label}｜報名 ${course.enrolled} 人｜需 ${course.need > 0 ? course.need : '未填'} 位｜已排 ${course.coaches.length} 位${course.coaches.length ? '：' + course.coaches.join('、') : ''}`,
      };
    }),
  };
}

export function timelineHeader(c: StageContext, venue: VenueConfig): { title: string; sub: string; tags: string[] } {
  const first = venue.duty[0]?.[1].split('-')[0] ?? '';
  const last = venue.duty[venue.duty.length - 1]?.[1].split('-')[1] ?? '';
  return { title: venue.name, sub: `${first}–${last} · ${selectedDayLabel(c.model.week, c.dayNo)}`, tags: [`救生 ${venue.lifeguardMin}–${venue.lifeguardMax}`, '櫃台 1–2'] };
}

export const COVERAGE_BANDS: readonly (readonly [string, string])[] = [
  ['05:30', '08:00'],
  ['08:00', '10:00'],
  ['10:00', '12:00'],
  ['12:00', '14:00'],
  ['14:00', '16:00'],
  ['16:00', '18:00'],
  ['18:00', '20:00'],
  ['20:00', '22:30'],
];

export interface MatrixMember {
  name: string;
  removable: { key: CellKey; raw: string } | null;
}

export type MatrixCell =
  | { kind: 'closed' }
  | { kind: 'open'; coverage: Coverage; members: MatrixMember[]; flag: string; needText: string; tip: string; fill: { venue: VenueName; role: DutyRole; dayNo: DayNo; segLabel: string } };

export interface MatrixView {
  role: DutyRole;
  hint: string;
  headers: { venue: VenueName; gaps: number; text: string }[];
  rows: { band: readonly [string, string]; cells: MatrixCell[] }[];
}

export function coverageMatrix(c: StageContext, role: DutyRole): MatrixView {
  const lists = new Map(VENUES.map(v => [v.name, shiftsFor(c, v, role)]));
  return {
    role,
    hint: `${selectedDayLabel(c.model.week, c.dayNo)} · 數字＝該時段最低在班，名單＝在班人員，顏色＝是否達標`,
    headers: VENUES.map(v => {
      const gaps = roleGapCount(lists.get(v.name)!, v, role);
      return { venue: v.name, gaps, text: gaps > 0 ? `${gaps} 缺口` : '全達標' };
    }),
    rows: COVERAGE_BANDS.map(band => {
      const range = parseTimeRange(`${band[0]}-${band[1]}`)!;
      return {
        band,
        cells: VENUES.map((v): MatrixCell => {
          const list = lists.get(v.name)!;
          const rule = venueRule(v, role);
          const segs = dutySegs(v);
          const open = segs[0]?.a ?? 0;
          const close = segs[segs.length - 1]?.b ?? 0;
          if (range.end <= open || range.start >= close) return { kind: 'closed' };
          const seg = { a: Math.max(range.start, open), b: Math.min(range.end, close) };
          const coverage = segCoverage(list, seg, rule);
          const members = segMembers(list, seg);
          const names = members.map(s => s.name);
          return {
            kind: 'open',
            coverage,
            members: members.map(s => ({ name: s.name, removable: s.source === 'draft' ? { key: s.key, raw: s.raw } : null })),
            flag: coverage.state === 'empty' ? '未排' : coverage.state === 'under' ? '不足' : coverage.state === 'over' ? '超量' : '',
            needText: `需 ${rule.min}–${rule.max}`,
            tip: `${v.name} ${band[0]}–${band[1]}｜在班 ${coverage.count} 人（需 ${rule.min}–${rule.max}）${names.length ? '｜' + names.join('、') : ''}　▸ 點空白處排班，按姓名旁 ✕ 移除`,
            fill: { venue: v.name, role, dayNo: c.dayNo, segLabel: `${minutesToTime(seg.a)}-${minutesToTime(seg.b)}` },
          };
        }),
      };
    }),
  };
}

export interface CourseRowView {
  course: StageCourse;
  state: CourseState;
  progress: number;
  needText: string;
  pill: string;
  buttonLabel: string;
  cellKey: string;
}

export function coursesView(c: StageContext, venue: VenueConfig): { title: string; countText: string; summaryText: string; needsWork: boolean; rows: CourseRowView[]; emptyText: string } {
  const list = stageCourses(c, venue);
  const summary = courseSummary(list);
  const period = dutyPeriodForDay(c.dayNo);
  const venueRows = c.model.venues.find(v => v.venue.name === venue.name)?.courseRows ?? [];
  return {
    title: `${venue.name} · ${selectedDayLabel(c.model.week, c.dayNo)} 課程`,
    countText: `${list.length} 門`,
    summaryText: courseSummaryText(summary),
    needsWork: courseSummaryNeedsWork(summary),
    emptyText: '本館本日無課程',
    rows: list.map(course => ({
      course,
      state: courseState(course),
      progress: clamp(Math.round((course.enrolled / 24) * 100), 0, 100),
      needText: `需 ${course.need > 0 ? course.need : '未填'} 位`,
      pill: coursePill(course),
      buttonLabel: course.coaches.length ? '＋ 排班' : '排班',
      cellKey: venueRows.find(r => r.rowId === course.id)?.coachCells.find(x => x.period === period)?.key ?? '',
    })),
  };
}

export interface StageControls {
  days: (WeekDate & { selected: boolean })[];
  coverageBadge: number;
  coursesBadge: number;
}

export function stageControls(c: StageContext): StageControls {
  return {
    days: datesInWeek(c.model.week).map(d => ({ ...d, selected: d.dayNo === c.dayNo })),
    coverageBadge: VENUES.reduce((s, v) => s + venueGapCount(c, v), 0),
    coursesBadge: VENUES.reduce((s, v) => s + courseMissCount(c, v), 0),
  };
}

export interface GapAssignment {
  targetKey: CellKey;
  rowCountUpdate: { key: CellKey; value: string } | null;
  timeLabel: string;
  title: string;
}

export function gapAssignment(model: WeekModel, venue: VenueName, role: DutyRole, dayNo: DayNo, segLabel: string): GapAssignment {
  const rowsKey = dutyGridRowsKey(model.week.no, venue, role);
  const count = dutyRowCount(model.draft, rowsKey);
  let targetKey: CellKey | null = null;
  for (let i = 1; i <= count && !targetKey; i++) {
    const key = dutyGridCellKey(model.week.no, venue, role, i, dayNo);
    if (!String(model.draft.cells.get(key) || '').trim()) targetKey = key;
  }
  return {
    targetKey: targetKey ?? dutyGridCellKey(model.week.no, venue, role, count + 1, dayNo),
    rowCountUpdate: targetKey ? null : { key: rowsKey, value: String(Math.max(1, count + 1)) },
    timeLabel: `${role === 'frontdesk' ? '櫃' : '救'}${compactTimeLabel(segLabel)}`,
    title: `排${ROLE_LABEL[role]}：${venue} ${selectedDayLabel(model.week, dayNo)} ${segLabel}`,
  };
}
