import { dayName } from './dates';
import { activeDaysForPeriod, minutesToTime, parseTimeRange, timesOverlap, usefulLines } from './parse';
import type { Roster } from './roster';
import type { DayNo, DutyPeriod, EmployeeId, TimeRange, WeekConfig } from './types';
import type { WorkEntry } from './validate';

export interface AvailabilityRow {
  employeeId: EmployeeId | '';
  name: string;
  venues: string;
  weekday: string;
  sat: string;
  sun: string;
  note: string;
  notSubmitted: boolean;
  lineBound: boolean | null;
}

interface Slot {
  startTime?: unknown;
  endTime?: unknown;
}

function formatSlots(slots: unknown, days?: unknown): string {
  if (!Array.isArray(slots) || !slots.length) return '';
  const dayStr = Array.isArray(days) && days.length ? days.join('') : '';
  return (slots as Slot[]).map(s => `${s.startTime}-${s.endTime}${dayStr ? ' ' + dayStr : ''}`).join('\n');
}

const idOf = (v: unknown): EmployeeId | '' => (typeof v === 'number' || typeof v === 'string' ? v : '');

export function availabilityRowsFromApi(items: readonly Record<string, unknown>[] | null, roster: Roster): AvailabilityRow[] {
  if (!items?.length) return [];
  return items.map(item => {
    const notSubmitted = item.submitted === false;
    const name = typeof item.employeeName === 'string' ? item.employeeName : '';
    const itemId = idOf(item.employeeId);
    const emp = itemId ? roster.byId(itemId) : roster.byName(name);
    const venues = notSubmitted ? '—' : Array.isArray(item.venueNames) ? item.venueNames.join('、') : '全部';
    return {
      employeeId: itemId || emp?.id || '',
      name,
      venues: (venues || emp?.venueName || '全部').trim() || '全部',
      weekday: notSubmitted ? '' : formatSlots(item.weekdaySlots, item.weekdayDays),
      sat: notSubmitted ? '' : formatSlots(item.satSlots),
      sun: notSubmitted ? '' : formatSlots(item.sunSlots),
      note: notSubmitted ? '未填報' : typeof item.notes === 'string' ? item.notes : '',
      notSubmitted,
      lineBound: emp ? emp.lineBound : null,
    };
  });
}

export interface AvailabilityInterval {
  employeeId: EmployeeId | '';
  name: string;
  venues: string;
  day: DayNo;
  time: TimeRange;
  raw: string;
}

function linesToIntervals(row: AvailabilityRow, text: string, period: DutyPeriod, week: WeekConfig): AvailabilityInterval[] {
  const days = activeDaysForPeriod(period, week);
  const out: AvailabilityInterval[] = [];
  usefulLines(text).forEach(line => {
    const m = line.match(/\d{1,2}:\d{2}\s*[-－~～]\s*\d{1,2}:\d{2}/);
    const time = m && parseTimeRange(m[0]);
    if (!m || !time) return;
    const rest = line.replace(m[0], ' ');
    const found = rest.match(/[1-5]+/g);
    const lineDays =
      period === 'weekday' && found ? Array.from(new Set(found.join('').split('').map(Number))).filter((d): d is DayNo => days.includes(d as DayNo)) : [...days];
    lineDays.forEach(day => out.push({ employeeId: row.employeeId || '', name: row.name, venues: row.venues, day, time, raw: line }));
  });
  return out;
}

export function availabilityIntervals(rows: readonly AvailabilityRow[], week: WeekConfig): AvailabilityInterval[] {
  return rows
    .filter(r => r.name.trim())
    .flatMap(r => {
      const row = { ...r, name: r.name.trim(), venues: r.venues.trim() || '全部' };
      return [...linesToIntervals(row, row.weekday.trim(), 'weekday', week), ...linesToIntervals(row, row.sat.trim(), 'sat', week), ...linesToIntervals(row, row.sun.trim(), 'sun', week)];
    });
}

export interface Interval {
  start: number;
  end: number;
}

export function subtractIntervals(base: Interval, busy: readonly Interval[]): Interval[] {
  let open: Interval[] = [{ start: base.start, end: base.end }];
  busy.forEach(b => {
    const next: Interval[] = [];
    open.forEach(seg => {
      if (b.end <= seg.start || b.start >= seg.end) {
        next.push(seg);
        return;
      }
      if (b.start > seg.start) next.push({ start: seg.start, end: Math.min(b.start, seg.end) });
      if (b.end < seg.end) next.push({ start: Math.max(b.end, seg.start), end: seg.end });
    });
    open = next.filter(s => s.end > s.start);
  });
  return open;
}

export const formatInterval = (x: Interval) => `${minutesToTime(x.start)}-${minutesToTime(x.end)}`;

export function busyLabel(w: WorkEntry): string {
  if (w.roleType === 'course') return `課程｜${w.venue || ''} ${w.courseName || ''} ${w.slotCode || ''}`.trim();
  return `${w.roleType === 'lifeguard' ? '救生' : '櫃台'}｜${w.venue || ''} ${w.time.label || ''}`.trim();
}

export interface BusyChip {
  kind: 'lifeguard-busy' | 'course-busy';
  text: string;
}

export interface AvailabilityReportRow {
  name: string;
  day: string;
  timeLabel: string;
  busy: BusyChip[];
  open: string[];
}

export const AVAILABILITY_REPORT_EMPTY = '目前沒有未排到工作的可用時段，或尚未輸入員工可上課時間。';

const samePerson = (a: { employeeId: EmployeeId | ''; name: string }, b: { employeeId: EmployeeId | ''; name: string }) =>
  a.employeeId && b.employeeId ? String(a.employeeId) === String(b.employeeId) : !!(a.name && b.name && a.name === b.name);

export function availabilityReport(intervals: readonly AvailabilityInterval[], work: readonly WorkEntry[]): AvailabilityReportRow[] {
  return intervals.flatMap(a => {
    const busy = work.filter(b => samePerson(a, b) && b.days.includes(a.day) && timesOverlap(a.time, b.time));
    const open = subtractIntervals(a.time, busy.map(b => b.time));
    if (!open.length) return [];
    return [
      {
        name: a.name || '未指定員工',
        day: `週${dayName(a.day)}`,
        timeLabel: a.time.label,
        busy: busy.map(b => ({
          kind: b.roleType === 'lifeguard' ? 'lifeguard-busy' : 'course-busy',
          text: b.roleType === 'course' ? `${busyLabel(b)} ${b.time.label}` : busyLabel(b),
        })),
        open: open.map(formatInterval),
      },
    ];
  });
}
