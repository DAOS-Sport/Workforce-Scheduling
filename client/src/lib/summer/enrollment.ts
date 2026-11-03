import { formatUpdatedTime } from './dates';
import type { EnrollmentItem, EnrollmentState } from './types';

const COURSE_NAME_BUCKETS: readonly (readonly [string, string])[] = [
  ['一般泳泳', '一般泳泳'],
  ['幼幼', '幼幼班泳泳'],
  ['玩水', '玩水班'],
  ['羽球', '室內羽球課'],
  ['籃球', '室外籃球課'],
  ['桌球', '室內桌球課'],
  ['棒球', '棒球課'],
  ['高階', '高階泳泳班'],
  ['假日', '泳泳假日班'],
];

export function normalizeCourseNameForEnrollment(name: string): string {
  const s = String(name || '').replace(/\s+/g, '').replace(/[（）()]/g, '').trim();
  if (!s) return '';
  return COURSE_NAME_BUCKETS.find(([needle]) => s.includes(needle))?.[1] ?? s;
}

export function enrollmentKey(weekNo: number | string, venueId: number | string, courseName: string, slotCode: string): string {
  return [String(weekNo || '').trim(), String(venueId || '').trim(), normalizeCourseNameForEnrollment(courseName), String(slotCode || '').trim().toUpperCase()].join('|');
}

export function enrollmentLookupKeys(weekNo: number, venueId: number | string, courseName: string, slotCode: string, kind: 'weekday' | 'holiday'): string[] {
  const keys = [enrollmentKey(weekNo, venueId, courseName, slotCode)];
  if (kind === 'holiday' && normalizeCourseNameForEnrollment(courseName) === '泳泳假日班') {
    keys.push(enrollmentKey(weekNo, venueId, '一般泳泳', slotCode));
  }
  return Array.from(new Set(keys));
}

export function normalizeEnrollmentItems(raw: readonly Record<string, unknown>[], fallbackWeekNo: number): EnrollmentItem[] {
  return raw
    .map(row => ({
      weekNo: Number(row.weekNo) || Number(fallbackWeekNo) || 0,
      venueId: String(row.venueId || '').trim(),
      courseName: typeof row.courseName === 'string' ? row.courseName : '',
      slotCode: String(row.slotCode || '').trim().toUpperCase(),
      registeredCount: Number(row.registeredCount) || 0,
      isClosed: row.isClosed === true,
      closureReason: typeof row.closureReason === 'string' ? row.closureReason : null,
    }))
    .filter(it => it.weekNo && it.venueId && it.courseName && it.slotCode);
}

export interface Closure {
  isClosed: boolean;
  reason: string | null;
}

export interface EnrollmentIndex {
  counts: ReadonlyMap<string, number>;
  closures: ReadonlyMap<string, Closure>;
}

export function indexEnrollment(items: readonly EnrollmentItem[]): EnrollmentIndex {
  const counts = new Map<string, number>();
  const closures = new Map<string, Closure>();
  items.forEach(item => {
    const k = enrollmentKey(item.weekNo, item.venueId, item.courseName, item.slotCode);
    const old = counts.get(k);
    counts.set(k, old === undefined ? item.registeredCount : Math.max(old, item.registeredCount));
    if (item.isClosed) closures.set(k, { isClosed: true, reason: item.closureReason });
    else if (!closures.has(k)) closures.set(k, { isClosed: false, reason: null });
  });
  return { counts, closures };
}

function firstHit<T>(map: ReadonlyMap<string, T>, keys: readonly string[]): T | undefined {
  for (const k of keys) if (map.has(k)) return map.get(k);
  return undefined;
}

export interface RowEnrollment {
  count: number;
  closure: Closure;
}

export function rowEnrollment(index: EnrollmentIndex, keys: readonly string[]): RowEnrollment {
  return { count: firstHit(index.counts, keys) ?? 0, closure: firstHit(index.closures, keys) ?? { isClosed: false, reason: null } };
}

export type ExternalCourses =
  | { kind: 'not-loaded' }
  | { kind: 'none-for-venue' }
  | { kind: 'rows'; rows: EnrollmentItem[]; total: number };

export function externalCourses(items: readonly EnrollmentItem[] | null, weekNo: number, venueId: number | string): ExternalCourses {
  if (!items) return { kind: 'not-loaded' };
  const rows = items
    .filter(r => Number(r.weekNo) === weekNo && String(r.venueId) === String(venueId))
    .sort((a, b) => String(a.courseName).localeCompare(b.courseName, 'zh-Hant') || String(a.slotCode).localeCompare(b.slotCode));
  if (!rows.length) return { kind: 'none-for-venue' };
  return { kind: 'rows', rows, total: rows.filter(r => !r.isClosed).reduce((s, r) => s + (Number(r.registeredCount) || 0), 0) };
}

export const EXTERNAL_EMPTY_TEXT = { 'not-loaded': '外部報名系統未連線或尚未取得資料。', 'none-for-venue': '本週此館別無外部報名課程。' } as const;

export function enrollmentStatusText(state: EnrollmentState): string {
  if (state.kind === 'failed') return state.message;
  if (state.kind === 'loading') return '報名人數：正式 API 模式';
  return `報名人數：API即時帶入${state.lastUpdated ? '｜更新 ' + formatUpdatedTime(state.lastUpdated) : ''}`;
}
