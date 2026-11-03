import { WEEKS } from './config';
import type { DayNo, IsoDate, WeekConfig, WeekNo } from './types';

const DAY_NAMES: Readonly<Record<DayNo, string>> = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };

export function dayName(d: number): string {
  return DAY_NAMES[d as DayNo] ?? String(d);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

function calendarDate(iso: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function isIsoDate(s: string): s is IsoDate {
  return calendarDate(s) !== null;
}

function utcDay(iso: IsoDate): Date {
  const c = calendarDate(iso)!;
  return new Date(Date.UTC(c.y, c.m - 1, c.d));
}

function isoOf(t: Date): IsoDate {
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}` as IsoDate;
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  const t = utcDay(iso);
  t.setUTCDate(t.getUTCDate() + n);
  return isoOf(t);
}

export function dayNoOf(iso: IsoDate): DayNo {
  const n = utcDay(iso).getUTCDay();
  return (n === 0 ? 7 : n) as DayNo;
}

export interface WeekDate {
  iso: IsoDate;
  dayNo: DayNo;
  label: string;
  weekday: string;
}

export function datesInWeek(week: WeekConfig): WeekDate[] {
  const out: WeekDate[] = [];
  for (let iso = week.start; iso <= week.end; iso = addDays(iso, 1)) {
    const dayNo = dayNoOf(iso);
    out.push({ iso, dayNo, label: `${iso.slice(5, 7)}/${iso.slice(8, 10)}`, weekday: `週${dayName(dayNo)}` });
  }
  return out;
}

export function isoDateForWeekDay(week: WeekConfig, dayNo: number): IsoDate | '' {
  if (!dayNo) return '';
  const iso = addDays(week.start, Number(dayNo) - dayNoOf(week.start));
  return iso < week.start || iso > week.end ? '' : iso;
}

export function weekNoForDate(iso: string): WeekNo | null {
  if (!isIsoDate(iso)) return null;
  return WEEKS.find(w => w.start <= iso && iso <= w.end)?.no ?? null;
}

export function formatManualDate(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}（${dayName(dayNoOf(iso))}）`;
}

function tokenToIso(token: string, year: number): IsoDate | null {
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(token);
  const iso = m
    ? `${Number(m[1])}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
    : (m = /^(\d{1,2})[/.-](\d{1,2})$/.exec(token))
      ? `${year}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`
      : null;
  return iso !== null && isIsoDate(iso) ? iso : null;
}

export function parseManualDates(raw: string, baseYear: number): IsoDate[] {
  const out: IsoDate[] = [];
  const seen = new Set<string>();
  const push = (iso: IsoDate) => {
    if (!seen.has(iso) && weekNoForDate(iso)) {
      seen.add(iso);
      out.push(iso);
    }
  };
  String(raw || '')
    .split(/[\s,，、;；]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(token => {
      const range = /^([^~～]+)[~～]([^~～]+)$/.exec(token);
      if (range) {
        const from = tokenToIso(range[1].trim(), baseYear);
        const to = tokenToIso(range[2].trim(), baseYear);
        if (!from || !to || from > to) return;
        for (let iso = from; iso <= to; iso = addDays(iso, 1)) push(iso);
        return;
      }
      const iso = tokenToIso(token, baseYear);
      if (iso) push(iso);
    });
  return out;
}

const TAIPEI = 'Asia/Taipei';

export function formatUpdatedTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString('zh-TW', { timeZone: TAIPEI, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function hourMinute(t: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TAIPEI, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}
