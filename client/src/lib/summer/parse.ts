import { VENUE_ID_BY_NAME } from './config';
import { findEmployeeForLine, type ParseContext } from './roster';
import type {
  CoachRole,
  CoursePeriod,
  DayNo,
  DutyPeriod,
  DutyRole,
  EmployeeId,
  LooseTimeRange,
  NameAliases,
  TimeRange,
  VenueName,
  WeekConfig,
} from './types';

const pad2 = (s: string) => s.padStart(2, '0');

export function parseTimeRange(text: string): TimeRange | null {
  const m = String(text || '').trim().match(/(\d{1,2}):(\d{2})\s*[-－~～]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (end <= start) return null;
  return { start, end, label: `${pad2(m[1])}:${m[2]}-${pad2(m[3])}:${m[4]}` };
}

export function parseLooseTimeRange(text: string): LooseTimeRange | null {
  const m = String(text || '').trim().match(/(\d{1,2}):?(\d{2})\s*(?:[-－~～]|到|至)\s*(\d{1,2}):?(\d{2})/);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (end <= start) return null;
  return { start, end, label: `${pad2(m[1])}:${m[2]}-${pad2(m[3])}:${m[4]}`, raw: m[0] };
}

export function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function compactTimeLabel(label: string): string {
  const t = parseLooseTimeRange(label);
  if (!t) return String(label || '');
  return `${minutesToTime(t.start).replace(':', '')}-${minutesToTime(t.end).replace(':', '')}`;
}

export function timesOverlap(a: { start: number; end: number } | null, b: { start: number; end: number } | null): boolean {
  return !!(a && b && Math.max(a.start, b.start) < Math.min(a.end, b.end));
}

export function normalizeName(str: string): string {
  return String(str || '')
    .replace(/[0-9]/g, '')
    .replace(/[()（）[\]【】,:：;；、/\\\-－]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function activeDaysForPeriod(period: string, week: WeekConfig): DayNo[] {
  if (period === 'weekday') return [...week.activeWeekdays];
  if (period === 'sat') return [6];
  if (period === 'sun') return [7];
  const m = /^manual-day-(\d)$/.exec(String(period || ''));
  if (m) return [Number(m[1]) as DayNo];
  return [7];
}

export function dutyPeriodForDay(dayNo: number): DutyPeriod {
  const d = Number(dayNo);
  if (d >= 1 && d <= 5) return 'weekday';
  if (d === 6) return 'sat';
  return 'sun';
}

export function cleanEmployeeDisplayName(name: string): string {
  return String(name || '')
    .replace(/（未綁定）/g, '')
    .replace(/\(未綁定\)/g, '')
    .replace(/（LINE未綁定）/g, '')
    .replace(/\(LINE未綁定\)/g, '')
    .trim();
}

const PLACEHOLDER_LINE = /^(待排|待確認|確認中|缺|無|x|X|-|－)$/;

export function usefulLines(text: string): string[] {
  return String(text || '')
    .split(/\n+/)
    .map(s => cleanEmployeeDisplayName(s.trim()))
    .filter(s => s && !PLACEHOLDER_LINE.test(s));
}

export function normalizeCellText(value: string): string {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

export function htmlToCellText(html: string): string {
  if (html == null || html === '') return '';
  return normalizeCellText(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(div|p|li)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/gi, "'")
      .replace(/&amp;/gi, '&'),
  );
}

export function slug(str: string): string {
  return String(str)
    .replace(/[()（）+＋\s/]/g, '_')
    .replace(/[^一-龥A-Za-z0-9_-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function venueIdByName(name: string): number | '' {
  const key = String(name || '').replace('夢想-', '').replace('分館', '').replace('館', '').trim();
  return VENUE_ID_BY_NAME[key as VenueName] ?? '';
}

export function resolveAlias(aliases: NameAliases, name: string): string {
  const k = String(name || '').trim();
  if (!k) return k;
  const v = Object.prototype.hasOwnProperty.call(aliases, k) ? aliases[k] : undefined;
  return (v && String(v).trim()) || k;
}

const FOLLOW_MARK = /跟課/g;
export const stripFollowMark = (s: string) => String(s || '').replace(FOLLOW_MARK, '');
export const hasFollowMark = (s: string) => /跟課/.test(String(s || ''));

export interface CoachLineParts {
  marker: string;
  follow: boolean;
  rawName: string;
  name: string;
  days: string;
}

export function splitCoachLineParts(line: string, aliases: NameAliases): CoachLineParts {
  const clean = cleanEmployeeDisplayName(String(line || '')).trim();
  const isMark = /^[＊*]/.test(clean) || /^[aAＡａ][一-龥]/.test(clean);
  const marker = isMark ? clean.slice(0, 1) : '';
  let rest = isMark ? clean.slice(1) : clean;
  const follow = hasFollowMark(rest);
  rest = stripFollowMark(rest);
  const dm = rest.match(/^(.*?)([1-7]+)\s*$/);
  const rawName = (dm ? dm[1] : rest).trim();
  return { marker, follow, rawName, name: resolveAlias(aliases, rawName), days: dm ? dm[2] : '' };
}

export interface CoachToken {
  marker: '' | '*' | 'a';
  body: string;
}

export function tokenizeCoachLine(line: string): CoachToken[] {
  const s = String(line || '')
    .replace(/[＊*]/g, '\u0001*')
    .replace(/(^|[^A-Za-z])[aAＡａ](?=[一-龥])/g, (_m, p1: string) => `${p1}\u0001a`);
  if (!s.includes('\u0001')) return [{ marker: '', body: String(line || '') }];
  return s
    .split('\u0001')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => {
      const mk = x[0] === '*' || x[0] === 'a' ? x[0] : '';
      return { marker: mk, body: mk ? x.slice(1) : x };
    });
}

function tileCoachNames(seg: string, names: ReadonlySet<string>, maxLen: number): string[] {
  if (!names.size || names.has(seg)) return [seg];
  const n = seg.length;
  const memo: (boolean | undefined)[] = new Array(n + 1).fill(undefined);
  const pick: number[] = new Array(n + 1).fill(0);
  const can = (i: number): boolean => {
    if (i === n) return true;
    if (memo[i] !== undefined) return memo[i]!;
    memo[i] = false;
    for (let len = Math.min(maxLen, n - i); len >= 2; len--) {
      if (names.has(seg.slice(i, i + len)) && can(i + len)) {
        memo[i] = true;
        pick[i] = len;
        break;
      }
    }
    return memo[i]!;
  };
  if (!can(0)) return [seg];
  const out: string[] = [];
  for (let i = 0; i < n; i += pick[i]) out.push(seg.slice(i, i + pick[i]));
  return out;
}

export function splitCoachNames(str: string, names: ReadonlySet<string>): string[] {
  const maxLen = names.size ? Math.max(...Array.from(names, n => n.length)) : 0;
  const out: string[] = [];
  String(str || '')
    .split(/[\s,，、;；/＋+]+/)
    .filter(Boolean)
    .forEach(seg => out.push(...tileCoachNames(seg, names, maxLen)));
  return out.length ? out : [String(str || '').trim()].filter(Boolean);
}

export function coachRoleOf(marker: string, follow: boolean): CoachRole {
  if (marker === '*' || marker === '＊') return '當班下';
  if (marker && /[aAＡａ]/.test(marker)) return '助教';
  return follow ? '跟課' : '教練';
}

export const COACH_TIME_RE = /\d{1,2}\s*[:：]?\s*\d{2}\s*[-－~～至到]\s*\d{1,2}\s*[:：]?\s*\d{2}|\d{1,2}\s*[:：]\s*\d{2}/g;

function weekdayDigits(text: string, allowed: readonly DayNo[]): DayNo[] {
  const m = text.match(/[1-5]+/g);
  if (!m) return [...allowed];
  return Array.from(new Set(m.join('').split('').map(Number))).filter((d): d is DayNo => allowed.includes(d as DayNo));
}

export interface ParsedLineEmployee {
  employeeId: EmployeeId | '';
  lineBound: boolean;
  role: string;
}

export interface CoachAssignmentLine extends ParsedLineEmployee {
  name: string;
  rawName: string;
  days: DayNo[];
  raw: string;
  coachRole: CoachRole;
  follow: boolean;
}

function lineEmployee(ctx: ParseContext, name: string, key: string): ParsedLineEmployee {
  const emp = findEmployeeForLine(ctx, name, key);
  return { employeeId: emp?.id || '', lineBound: !!emp?.lineBound, role: emp?.role || '' };
}

export function parseAssignments(ctx: ParseContext, text: string, period: CoursePeriod, week: WeekConfig, metaKey = ''): CoachAssignmentLine[] {
  const def = activeDaysForPeriod(period, week);
  const rows: CoachAssignmentLine[] = [];
  usefulLines(text).forEach(line => {
    tokenizeCoachLine(line).forEach(tok => {
      const follow = hasFollowMark(tok.body);
      const body = stripFollowMark(tok.body);
      const days = period === 'weekday' ? weekdayDigits(body.replace(COACH_TIME_RE, ' '), def) : [...def];
      const nameStr = normalizeName(body.replace(/[1-5]+/g, ' '));
      const coachRole = coachRoleOf(tok.marker, follow);
      splitCoachNames(nameStr, ctx.roster.names).forEach(raw => {
        const name = resolveAlias(ctx.aliases, raw);
        if (name && days.length) rows.push({ name, rawName: raw, ...lineEmployee(ctx, name, metaKey), days, raw: line, coachRole, follow });
      });
    });
  });
  return rows;
}

export function roleMarkerFromLine(line: string): DutyRole | '' {
  if (/櫃台|櫃|front\s*desk|fd/i.test(line)) return 'frontdesk';
  if (/救生|救|life\s*guard|lg/i.test(line)) return 'lifeguard';
  return '';
}

export function cleanDutyGridName(line: string, timeRaw: string): string {
  return normalizeName(
    String(line || '')
      .replace(timeRaw || '', ' ')
      .replace(/櫃台|櫃|救生|救|front\s*desk|life\s*guard|\bfd\b|\blg\b/gi, ' ')
      .replace(/[1-7]+/g, ' '),
  );
}

export interface DutyLine extends ParsedLineEmployee {
  name: string;
  time: LooseTimeRange;
  dayNo: DayNo;
  raw: string;
}

export function parseDutyGridLines(ctx: ParseContext, text: string, role: DutyRole, dayNo: DayNo, metaKey = ''): DutyLine[] {
  const rows: DutyLine[] = [];
  usefulLines(text).forEach(line => {
    const time = parseLooseTimeRange(line);
    if (!time) return;
    const marker = roleMarkerFromLine(line);
    if (marker && marker !== role) return;
    const name = cleanDutyGridName(line, time.raw);
    if (name) rows.push({ name, ...lineEmployee(ctx, name, metaKey), time, dayNo, raw: line });
  });
  return rows;
}

export function assignmentIdentity(a: { employeeId: EmployeeId | ''; name: string }): string {
  return a.employeeId ? `id:${a.employeeId}` : `name:${a.name}`;
}

export function duplicateNames(assignments: readonly { employeeId: EmployeeId | ''; name: string }[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  assignments.forEach(a => {
    const key = assignmentIdentity(a);
    if (seen.has(key)) dup.add(a.name || '未指定員工');
    seen.add(key);
  });
  return Array.from(dup);
}

export function countAssignmentsByDay(assignments: readonly CoachAssignmentLine[], days: readonly DayNo[]): Map<DayNo, number> {
  const sets = new Map<DayNo, Set<string>>(days.map(d => [d, new Set<string>()]));
  assignments.forEach(a => a.days.forEach(d => sets.get(d)?.add(assignmentIdentity(a))));
  return new Map(Array.from(sets, ([d, s]) => [d, s.size]));
}

export function countDistinctAssignees(assignments: readonly CoachAssignmentLine[]): number {
  return new Set(assignments.map(assignmentIdentity)).size;
}

export function tokenNames(tok: CoachToken, names: ReadonlySet<string>): string[] {
  return splitCoachNames(normalizeName(String(tok.body || '').replace(/[1-5]+/g, ' ')), names);
}
