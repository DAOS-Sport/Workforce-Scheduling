import { COURSE_TYPE_HOURS_DEFAULT, COURSE_TYPES_DEFAULT, CRAM_SCHOOLS_DEFAULT, MULTIPLIER_DEFAULT, PAYROLL_ROLES } from './config';
import { dayName, isoDateForWeekDay } from './dates';
import { parseTimeRange } from './parse';
import type { Roster } from './roster';
import type { CoachRole, DayNo, NormalizedAssignment, WeekConfig } from './types';

export type PayrollRole = (typeof PAYROLL_ROLES)[number];

export interface PayrollConfig {
  hours: Readonly<Record<string, string | number>>;
  rates: Readonly<Record<string, string>>;
  mult: Readonly<Partial<Record<'當班下' | '助教', string>>>;
  typeOverrides: Readonly<Record<string, string>>;
  cramSchools: readonly string[] | null;
  nameAliases: Readonly<Record<string, string>>;
  types: readonly string[] | null;
  hourly: Readonly<Partial<Record<'lifeguard' | 'frontdesk', string>>>;
  note: string;
}

export const EMPTY_PAYROLL_CONFIG: PayrollConfig = { hours: {}, rates: {}, mult: {}, typeOverrides: {}, cramSchools: null, nameAliases: {}, types: null, hourly: {}, note: '' };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stringRecord = (v: unknown): Record<string, string> =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => [k, String(x)])) : {};

export type PayrollConfigLoad = { kind: 'loaded'; config: PayrollConfig } | { kind: 'unset' } | { kind: 'invalid' };

export function parsePayrollConfig(raw: unknown): PayrollConfigLoad {
  const payload = isRecord(raw) && raw.data !== undefined ? raw.data : raw;
  const txt = isRecord(payload) ? (payload.value != null ? payload.value : '') : payload;
  if (!txt) return { kind: 'unset' };
  let obj: unknown;
  try {
    obj = typeof txt === 'string' ? JSON.parse(txt) : txt;
  } catch {
    return { kind: 'invalid' };
  }
  if (!isRecord(obj)) return { kind: 'invalid' };
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.map(String) : null);
  return {
    kind: 'loaded',
    config: {
      hours: isRecord(obj.hours) ? (obj.hours as Record<string, string | number>) : {},
      rates: stringRecord(obj.rates),
      mult: stringRecord(obj.mult),
      typeOverrides: stringRecord(obj.typeOverrides),
      cramSchools: Array.isArray(obj.cramSchools) ? obj.cramSchools.map(String) : null,
      nameAliases: stringRecord(obj.nameAliases),
      types: list(obj.types),
      hourly: stringRecord(obj.hourly),
      note: typeof obj.note === 'string' ? obj.note : '',
    },
  };
}

export function courseTypes(config: PayrollConfig): readonly string[] {
  return config.types?.length ? config.types : COURSE_TYPES_DEFAULT;
}

export function hoursOf(config: PayrollConfig, type: string): number {
  const v = config.hours[type];
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : COURSE_TYPE_HOURS_DEFAULT[type] || 0;
}

export function cramSchools(config: PayrollConfig): readonly string[] {
  return config.cramSchools?.length ? config.cramSchools : CRAM_SCHOOLS_DEFAULT;
}

export function parseCramSchools(raw: string): string[] {
  return String(raw || '')
    .split(/[\s,，、;；]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function isCramCourse(config: PayrollConfig, name: string): boolean {
  const n = String(name || '').trim();
  return !!n && cramSchools(config).some(s => s && n.indexOf(String(s).trim()) === 0);
}

export function courseDurationHours(start: string, end: string): number {
  const m = (t: string) => {
    const p = String(t || '').split(':');
    return +p[0] * 60 + +p[1];
  };
  const a = m(start);
  let b = m(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (b <= a) b += 1440;
  return (b - a) / 60;
}

export interface ClassifiableRow {
  courseName?: string;
  workName?: string;
  dateType?: string;
  day?: DayNo | '';
  startTime?: string;
  endTime?: string;
}

export function classifyCourseType(config: PayrollConfig, row: ClassifiableRow): string {
  const n = String(row.courseName || row.workName || '').replace('(假日班)', '');
  const ov = config.typeOverrides[n];
  if (ov && courseTypes(config).includes(ov)) return ov;
  if (row.dateType === 'sat' || row.dateType === 'sun' || row.dateType === 'holiday' || row.day === 6 || row.day === 7) return '游泳假日班';
  if (isCramCourse(config, n)) return '補習班課程';
  if (/羽球|籃球|桌球|棒球|排球|足球|網球|球/.test(n)) return '球類課程';
  if (n === '立得補習班' || n === '空中美語') return '補習班課程';
  if (n === '幼幼班游泳') return '幼兒游泳班';
  if (n === '一般游泳(6足歲以上)' || n === '高階游泳班' || n === '玩水班') return '游泳一般團班';
  if (/游泳$/.test(n)) return '補習班課程';
  if (/舞蹈/.test(n)) return '補習班課程';
  if (n.indexOf('體育課') >= 0 || n === '夏令營') return courseDurationHours(row.startTime ?? '', row.endTime ?? '') >= 1.75 ? '體育課(長)' : '體育課(短)';
  return '補習班課程';
}

export function multiplier(config: PayrollConfig, role: '當班下' | '助教'): number {
  const v = config.mult[role];
  if (v == null || v === '') return MULTIPLIER_DEFAULT[role];
  const n = Number(v);
  return Number.isFinite(n) ? n : MULTIPLIER_DEFAULT[role];
}

export function rateFor(config: PayrollConfig, type: string, role: string): number {
  if (!courseTypes(config).includes(type)) return 0;
  const r = (PAYROLL_ROLES as readonly string[]).includes(role || '教練') ? role || '教練' : '教練';
  return Number(config.rates[`${type}|${r}`]) || 0;
}

export function withCoachRate(config: PayrollConfig, type: string, coachRate: string): PayrollConfig {
  const base = Number(coachRate) || 0;
  return {
    ...config,
    rates: {
      ...config.rates,
      [`${type}|教練`]: coachRate,
      [`${type}|當班下`]: String(Math.round(base * multiplier(config, '當班下'))),
      [`${type}|助教`]: String(Math.round(base * multiplier(config, '助教'))),
    },
  };
}

export function withMultipliers(config: PayrollConfig, lead: number, assist: number): PayrollConfig {
  const next: PayrollConfig = { ...config, mult: { 當班下: String(lead), 助教: String(assist) } };
  return courseTypes(next).reduce<PayrollConfig>((c, t) => withCoachRate(c, t, c.rates[`${t}|教練`] ?? '0'), next);
}

export interface SalaryRateItem {
  role?: unknown;
  label?: unknown;
  ratePerHour?: unknown;
  rate?: unknown;
  amount?: unknown;
}

export type SalaryRateTarget = 'lifeguard' | 'frontdesk' | 'manual' | 'course' | '';

export function salaryRateTarget(item: SalaryRateItem): SalaryRateTarget {
  const text = `${item.role || ''} ${item.label || ''}`.toLowerCase();
  if (/救生|lifeguard|life\s*guard/.test(text)) return 'lifeguard';
  if (/櫃台|frontdesk|front\s*desk|行政/.test(text)) return 'frontdesk';
  if (/手動|manual/.test(text)) return 'manual';
  if (/教練|課程|course|coach/.test(text)) return 'course';
  return '';
}

export interface HourlyRates {
  lifeguard: number;
  frontdesk: number;
}

export function hourlyRates(config: PayrollConfig, salaryRates: readonly SalaryRateItem[]): HourlyRates {
  const fromBackend = (role: 'lifeguard' | 'frontdesk') => {
    const hit = salaryRates.find(i => salaryRateTarget(i) === role);
    return hit ? Number(hit.ratePerHour ?? hit.rate ?? hit.amount ?? 0) || 0 : 0;
  };
  const pick = (role: 'lifeguard' | 'frontdesk') => {
    const v = config.hourly[role];
    return v != null && v !== '' ? Number(v) || 0 : fromBackend(role);
  };
  return { lifeguard: pick('lifeguard'), frontdesk: pick('frontdesk') };
}

export function moneyText(value: number): string {
  return '$' + Math.round(Number(value) || 0).toLocaleString('en-US');
}

export function durationHours(start: string, end: string): number {
  const t = parseTimeRange(`${start}-${end}`);
  return t ? Math.max(0, (t.end - t.start) / 60) : 0;
}

export function roleTypeLabel(a: Pick<NormalizedAssignment, 'roleType' | 'source'>): string {
  if (a.roleType === 'course') return a.source === 'manual' ? '手動課程' : '一般課程';
  return a.roleType === 'lifeguard' ? '救生' : '櫃台';
}

export function roleTypeClass(a: Pick<NormalizedAssignment, 'roleType' | 'source'>): 'manual' | 'course' | 'lifeguard' | 'frontdesk' {
  if (a.roleType === 'course') return a.source === 'manual' ? 'manual' : 'course';
  return a.roleType;
}

export type PayrollRow = NormalizedAssignment & {
  date: string;
  day: DayNo | '';
  hours: number;
  unit: number;
  typeLabel: string;
  typeClass: string;
  workName: string;
};

export function expandPayrollRows(assignments: readonly NormalizedAssignment[], week: WeekConfig): PayrollRow[] {
  const rows: PayrollRow[] = [];
  assignments.forEach(a => {
    const days: (DayNo | '')[] = a.days.length ? a.days : [''];
    days.forEach(day => {
      const hours = durationHours(a.startTime, a.endTime);
      rows.push({
        ...a,
        date: (a.roleType === 'course' && a.date) || (day ? isoDateForWeekDay(week, day) : ''),
        day,
        hours,
        unit: a.roleType === 'course' ? 1 : hours,
        typeLabel: roleTypeLabel(a),
        typeClass: roleTypeClass(a),
        workName: a.roleType === 'course' ? a.courseName || '課程' : roleTypeLabel(a),
      });
    });
  });
  return rows.sort((x, y) => `${x.date}${x.startTime}${x.employeeName}`.localeCompare(`${y.date}${y.startTime}${y.employeeName}`));
}

export function employeeKey(row: { employeeId: unknown; employeeName?: string }): string {
  return row.employeeId ? `id-${row.employeeId}` : `name-${row.employeeName || '未指定員工'}`;
}

export interface PayCalc {
  unit: string;
  rate: number;
  amount: number;
  formula: string;
}

export type PricedRow = PayrollRow & { payCalc: PayCalc; courseType: string | null; courseHours: number };

export function priceRows(rows: readonly PayrollRow[], config: PayrollConfig, hourly: HourlyRates): PricedRow[] {
  return rows.map(r => {
    if (r.roleType === 'course') {
      const type = classifyCourseType(config, r);
      const role: CoachRole = r.coachRole || '教練';
      const rate = rateFor(config, type, role);
      return { ...r, payCalc: { unit: '1 堂', rate, amount: rate, formula: `1 堂 × ${moneyText(rate)}（${type}・${role}）` }, courseType: type, courseHours: hoursOf(config, type) || 0 };
    }
    const rate = r.roleType === 'frontdesk' ? hourly.frontdesk : hourly.lifeguard;
    return {
      ...r,
      payCalc: { unit: `${r.hours.toFixed(1)} 小時`, rate, amount: r.hours * rate, formula: `${r.hours.toFixed(1)} 小時 × ${moneyText(rate)} / 小時` },
      courseType: null,
      courseHours: 0,
    };
  });
}

type Block = '平日' | '假日' | '手動';
export function blockOf(r: Pick<PayrollRow, 'dateType' | 'day' | 'source'>): Block {
  if (r.dateType === 'sat' || r.dateType === 'sun' || r.day === 6 || r.day === 7) return '假日';
  if (r.source === 'manual') return '手動';
  return '平日';
}

type SubRole = '當班下' | '助教' | '跟課';
const SUB_ROLES: readonly SubRole[] = ['當班下', '助教', '跟課'];
const isSubRole = (r: string): r is SubRole => (SUB_ROLES as readonly string[]).includes(r);

export interface CourseGroup {
  name: string;
  type: string;
  role: CoachRole;
  slot: string;
  block: Block;
  days: Set<DayNo | ''>;
  n: number;
  h: number;
}

export interface StaffStats {
  key: string;
  employeeName: string;
  lineBound: boolean;
  inRoster: boolean;
  courseSessions: number;
  courseHours: number;
  lifeguardShifts: number;
  frontdeskShifts: number;
  lifeguardHours: number;
  frontdeskHours: number;
  pay: number;
  typeCount: Map<string, number>;
  roleCount: Record<SubRole, number>;
  roleHours: Record<SubRole, number>;
  courses: Map<string, CourseGroup>;
}

export const staffTotalHours = (s: StaffStats) => s.courseHours + s.lifeguardHours + s.frontdeskHours;

export function staffStats(rows: readonly PricedRow[], config: PayrollConfig): StaffStats[] {
  const map = new Map<string, StaffStats>();
  rows.forEach(r => {
    const key = employeeKey(r);
    if (!map.has(key)) {
      map.set(key, {
        key,
        employeeName: r.employeeName || '未指定員工',
        lineBound: !!r.lineBound,
        inRoster: !!r.employeeId,
        courseSessions: 0,
        courseHours: 0,
        lifeguardShifts: 0,
        frontdeskShifts: 0,
        lifeguardHours: 0,
        frontdeskHours: 0,
        pay: 0,
        typeCount: new Map(),
        roleCount: { 當班下: 0, 助教: 0, 跟課: 0 },
        roleHours: { 當班下: 0, 助教: 0, 跟課: 0 },
        courses: new Map(),
      });
    }
    const s = map.get(key)!;
    s.lineBound = s.lineBound || !!r.lineBound;
    s.inRoster = s.inRoster || !!r.employeeId;
    if (r.roleType === 'course' && r.courseType) {
      s.courseSessions += 1;
      s.courseHours += r.courseHours;
      s.pay += r.payCalc.amount;
      s.typeCount.set(r.courseType, (s.typeCount.get(r.courseType) ?? 0) + 1);
      const role: CoachRole = r.coachRole || '教練';
      if (isSubRole(role)) {
        s.roleCount[role] += 1;
        s.roleHours[role] += r.courseHours || 0;
      }
      const gk = `${r.workName}|${r.courseType}|${r.slotCode || ''}|${role}`;
      if (!s.courses.has(gk)) s.courses.set(gk, { name: r.workName, type: r.courseType, role, slot: r.slotCode || '', block: blockOf(r), days: new Set(), n: 0, h: hoursOf(config, r.courseType) || 0 });
      const g = s.courses.get(gk)!;
      g.days.add(r.day);
      g.n += 1;
    } else if (r.roleType === 'lifeguard') {
      s.lifeguardShifts += 1;
      s.lifeguardHours += r.hours;
      s.pay += r.payCalc.amount;
    } else if (r.roleType === 'frontdesk') {
      s.frontdeskShifts += 1;
      s.frontdeskHours += r.hours;
      s.pay += r.payCalc.amount;
    }
  });
  return Array.from(map.values());
}

export interface Kpi {
  tone: string;
  label: string;
  value: string;
  sub: string;
}

export function kpis(stats: readonly StaffStats[]): Kpi[] {
  const T = stats.reduce(
    (a, s) => ({
      staff: a.staff + 1,
      cs: a.cs + s.courseSessions,
      ch: a.ch + s.courseHours,
      lg: a.lg + s.lifeguardShifts,
      lgh: a.lgh + s.lifeguardHours,
      fd: a.fd + s.frontdeskShifts,
      fdh: a.fdh + s.frontdeskHours,
      pay: a.pay + s.pay,
    }),
    { staff: 0, cs: 0, ch: 0, lg: 0, lgh: 0, fd: 0, fdh: 0, pay: 0 },
  );
  return [
    { tone: 'teal', label: '員工數', value: `${T.staff}`, sub: '本週有排班' },
    { tone: 'ink', label: '課程堂數', value: `${T.cs}`, sub: '單堂計' },
    { tone: 'amber', label: '課程時數', value: `${T.ch.toFixed(1)}h`, sub: '依類型標準時數' },
    { tone: 'emerald', label: '救生', value: `${T.lg}班`, sub: `${T.lgh.toFixed(1)} 小時` },
    { tone: 'emerald', label: '櫃台', value: `${T.fd}班`, sub: `${T.fdh.toFixed(1)} 小時` },
    { tone: 'rose', label: '試算薪資', value: moneyText(T.pay), sub: '填費率後更新' },
  ];
}

export interface TypeSummaryRow {
  type: string;
  hoursPerSession: number;
  weekday: number;
  holiday: number;
  manual: number;
  total: number;
  lead: number;
  assist: number;
  follow: number;
  hours: number;
}

export function typeSummary(rows: readonly PricedRow[], config: PayrollConfig): { rows: TypeSummaryRow[]; total: TypeSummaryRow } {
  const agg = new Map(courseTypes(config).map(t => [t, { 平日: 0, 假日: 0, 手動: 0, 當班下: 0, 助教: 0, 跟課: 0 }]));
  rows.forEach(r => {
    if (r.roleType !== 'course' || !r.courseType) return;
    const a = agg.get(r.courseType);
    if (!a) return;
    a[blockOf(r)] += 1;
    const role = r.coachRole || '教練';
    if (isSubRole(role)) a[role] += 1;
  });
  const out = courseTypes(config).map(t => {
    const a = agg.get(t)!;
    const total = a.平日 + a.假日 + a.手動;
    return { type: t, hoursPerSession: hoursOf(config, t), weekday: a.平日, holiday: a.假日, manual: a.手動, total, lead: a.當班下, assist: a.助教, follow: a.跟課, hours: total * hoursOf(config, t) };
  });
  const sum = (f: keyof TypeSummaryRow) => out.reduce((s, r) => s + (r[f] as number), 0);
  return {
    rows: out,
    total: { type: '合計', hoursPerSession: 0, weekday: sum('weekday'), holiday: sum('holiday'), manual: sum('manual'), total: sum('total'), lead: sum('lead'), assist: sum('assist'), follow: sum('follow'), hours: sum('hours') },
  };
}

export function sortStaff(stats: readonly StaffStats[]): StaffStats[] {
  return [...stats].sort((a, b) => staffTotalHours(b) - staffTotalHours(a) || a.employeeName.localeCompare(b.employeeName, 'zh-Hant'));
}

export function coachOptionNames(stats: readonly StaffStats[]): string[] {
  return stats.map(s => s.employeeName).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export function roleMemo(s: Pick<StaffStats, 'roleCount' | 'roleHours'>): string {
  const memo: string[] = [];
  if (s.roleCount.當班下) memo.push(`＊${s.roleCount.當班下}(${s.roleHours.當班下.toFixed(1)}h)`);
  if (s.roleCount.助教) memo.push(`a${s.roleCount.助教}(${s.roleHours.助教.toFixed(1)}h)`);
  if (s.roleCount.跟課) memo.push(`跟${s.roleCount.跟課}(${s.roleHours.跟課.toFixed(1)}h)`);
  return memo.join('　');
}

export type CoachFilter = { kind: 'all' } | { kind: 'exact'; key: string; name: string } | { kind: 'fuzzy'; text: string };

export function coachFilter(input: string, stats: readonly StaffStats[]): CoachFilter {
  const raw = String(input || '').trim();
  if (!raw) return { kind: 'all' };
  const exact = stats.filter(s => s.employeeName === raw);
  return exact.length === 1 ? { kind: 'exact', key: exact[0].key, name: exact[0].employeeName } : { kind: 'fuzzy', text: raw };
}

export function matchesCoach(row: { employeeId: unknown; employeeName?: string }, f: CoachFilter): boolean {
  if (f.kind === 'all') return true;
  if (f.kind === 'fuzzy') return String(row.employeeName || '').includes(f.text);
  return employeeKey(row) === f.key;
}

export function filterHint(f: CoachFilter, visibleCount: number): string {
  if (f.kind === 'all') return '';
  const name = f.kind === 'fuzzy' ? f.text : f.name;
  return `篩選中：${name}${f.kind === 'fuzzy' ? '（姓名模糊比對，若有同名者會一併列出）' : ''}（下方兩張明細表共 ${visibleCount} 筆；上方 KPI 與彙整仍為全體）`;
}

const BLOCK_ORDER: Record<Block, number> = { 平日: 0, 假日: 1, 手動: 2 };

export interface CoachDetail {
  staff: StaffStats;
  groups: (CourseGroup & { amount: number; hours: number; dayChips: DayNo[] })[];
  subtotal: { n: number; h: number; amount: number };
}

export function coachDetail(stats: readonly StaffStats[], f: CoachFilter, config: PayrollConfig): CoachDetail[] {
  return sortStaff(stats)
    .filter(s => s.courseSessions > 0 && (f.kind === 'all' || (f.kind === 'fuzzy' ? s.employeeName.includes(f.text) : s.key === f.key)))
    .map(s => {
      const groups = [...s.courses.values()]
        .sort((a, b) => BLOCK_ORDER[a.block] - BLOCK_ORDER[b.block] || a.name.localeCompare(b.name, 'zh-Hant'))
        .map(g => ({
          ...g,
          amount: g.n * rateFor(config, g.type, g.role),
          hours: g.n * g.h,
          dayChips: ([1, 2, 3, 4, 5, 6, 7] as DayNo[]).filter(d => g.days.has(d)),
        }));
      return {
        staff: s,
        groups,
        subtotal: groups.reduce((t, g) => ({ n: t.n + g.n, h: t.h + g.hours, amount: t.amount + g.amount }), { n: 0, h: 0, amount: 0 }),
      };
    });
}

export function slotBadge(g: Pick<CourseGroup, 'slot' | 'block'>): { text: string; block: boolean } {
  return g.slot && g.slot !== 'MANUAL' ? { text: g.slot, block: false } : { text: g.block, block: true };
}

export interface NameAuditRow {
  name: string;
  sessions: number;
  status: 'unmatched' | 'resolved' | 'alias-not-in-roster';
  statusText: string;
  alias: string;
}

const AUDIT_TEXT = { unmatched: '名冊查無', resolved: '已歸戶', 'alias-not-in-roster': '指定的姓名不在名冊' } as const;

export function nameAudit(rows: readonly PayrollRow[], config: PayrollConfig, roster: Roster): NameAuditRow[] {
  const agg = new Map<string, number>();
  rows.forEach(r => {
    if (r.roleType !== 'course' || r.employeeId) return;
    const shown = String(r.rawName || r.employeeName || '').trim();
    if (shown) agg.set(shown, (agg.get(shown) ?? 0) + 1);
  });
  return [...agg.keys()]
    .sort((a, b) => agg.get(b)! - agg.get(a)! || a.localeCompare(b, 'zh-Hant'))
    .map(name => {
      const alias = config.nameAliases[name] || '';
      const status = alias ? (roster.names.has(alias) ? 'resolved' : 'alias-not-in-roster') : 'unmatched';
      return { name, sessions: agg.get(name)!, status, statusText: AUDIT_TEXT[status], alias };
    });
}

export const NAME_AUDIT_EMPTY = '本週所有姓名都對得到名冊。';

export function withNameAlias(config: PayrollConfig, from: string, to: string): PayrollConfig {
  const key = String(from || '').trim();
  const val = String(to || '').trim();
  const nameAliases = { ...config.nameAliases };
  if (val) nameAliases[key] = val;
  else delete nameAliases[key];
  return { ...config, nameAliases };
}

export interface CourseTypeMapRow {
  name: string;
  sessions: number;
  guess: string;
  override: string;
  effective: string;
  differs: boolean;
  hoursText: string;
}

export function courseTypeMap(rows: readonly PayrollRow[], config: PayrollConfig): CourseTypeMapRow[] {
  const agg = new Map<string, { n: number; row: PayrollRow }>();
  rows.forEach(r => {
    if (r.roleType !== 'course') return;
    const name = r.courseName || r.workName || '';
    if (!name) return;
    const a = agg.get(name) ?? { n: 0, row: r };
    a.n += 1;
    agg.set(name, a);
  });
  return [...agg.keys()]
    .sort((a, b) => agg.get(b)!.n - agg.get(a)!.n || a.localeCompare(b, 'zh-Hant'))
    .map(name => {
      const { n, row } = agg.get(name)!;
      const override = config.typeOverrides[name] || '';
      const { [name]: _drop, ...rest } = config.typeOverrides;
      const guess = classifyCourseType({ ...config, typeOverrides: rest }, { ...row, courseName: name });
      const effective = override || guess;
      return { name, sessions: n, guess, override, effective, differs: !!override && override !== guess, hoursText: hoursOf(config, effective).toFixed(2) };
    });
}

export const COURSE_TYPE_MAP_EMPTY = '本週沒有課程。';

export function withTypeOverride(config: PayrollConfig, name: string, type: string): PayrollConfig {
  const typeOverrides = { ...config.typeOverrides };
  if (type) typeOverrides[name] = type;
  else delete typeOverrides[name];
  return { ...config, typeOverrides };
}

export type TypeEdit = { kind: 'changed'; config: PayrollConfig } | { kind: 'rejected'; message: string } | { kind: 'unchanged' };

export function addCourseType(config: PayrollConfig, raw: string): TypeEdit {
  const name = String(raw || '').trim();
  if (!name) return { kind: 'unchanged' };
  if (courseTypes(config).includes(name)) return { kind: 'rejected', message: '已經有這個課程類型了。' };
  return { kind: 'changed', config: { ...config, types: [...courseTypes(config), name], hours: config.hours[name] == null ? { ...config.hours, [name]: '1' } : config.hours } };
}

export function removeCourseType(config: PayrollConfig, type: string): TypeEdit {
  if ((COURSE_TYPES_DEFAULT as readonly string[]).includes(type)) return { kind: 'rejected', message: '內建類型不可刪除。若不想用，把費率留 0 即可。' };
  const typeOverrides = Object.fromEntries(Object.entries(config.typeOverrides).filter(([, v]) => v !== type));
  return { kind: 'changed', config: { ...config, types: courseTypes(config).filter(x => x !== type), typeOverrides } };
}

export const removeCourseTypeConfirm = (t: string) => `確定刪除課程類型「${t}」？\n已指定為此類型的課名會回到系統自動判定。`;

export const CONFIG_NOT_LOADED = '尚未讀到後端設定，暫時不能修改（避免蓋掉既有設定）。請重新整理頁面後再試。';

export const TYPE_BADGE_CLASS: Readonly<Record<string, string>> = { 游泳一般團班: 'swim', 游泳假日班: 'swim', 幼兒游泳班: 'kid', 補習班課程: 'cram', 球類課程: 'ball', '體育課(短)': 'pe', '體育課(長)': 'pe' };
export const typeBadgeClass = (t: string) => TYPE_BADGE_CLASS[t] || 'cram';
const ROLE_BADGE_CLASS: Record<CoachRole, string> = { 當班下: 'lead', 助教: 'assist', 教練: 'coach', 跟課: 'follow' };
export function roleBadge(role: string): { text: string; className: string } {
  const text = role || '教練';
  return { text, className: ROLE_BADGE_CLASS[text as CoachRole] ?? 'coach' };
}

export interface DetailRow {
  row: PricedRow;
  dateText: string;
  weekdayText: string;
  star: boolean;
  badgeClass: 'life' | 'desk' | 'swim';
  slotText: string;
  courseTypeText: string;
  timeText: string;
  hoursText: string;
  amountText: string;
}

export function weekDetail(rows: readonly PricedRow[]): DetailRow[] {
  return rows.map(r => ({
    row: r,
    dateText: r.date || '',
    weekdayText: r.day ? `週${dayName(r.day)}` : '',
    star: !r.employeeId,
    badgeClass: r.roleType === 'lifeguard' ? 'life' : r.roleType === 'frontdesk' ? 'desk' : 'swim',
    slotText: r.slotCode && r.slotCode !== 'MANUAL' ? r.slotCode : '',
    courseTypeText: r.roleType === 'course' ? r.courseType ?? '' : '—',
    timeText: `${r.startTime || ''}-${r.endTime || ''}`,
    hoursText: r.roleType === 'course' ? (r.courseHours || 0).toFixed(2) : r.hours.toFixed(1),
    amountText: moneyText(r.payCalc.amount),
  }));
}

export const CSV_HEADER = ['日期', '星期', '員工', '館別', '類型', '課程/工作', '角色', '課程類型', '開始', '結束', '人數', '課程時數', '計算公式', '金額'] as const;

export function payrollCsv(rows: readonly PricedRow[], f: CoachFilter): { csv: string; count: number; note: string } {
  const picked = rows.filter(r => matchesCoach(r, f));
  const body = picked.map(r => [
    r.date || '',
    r.day ? `週${dayName(r.day)}` : '',
    r.employeeName || '',
    r.venueName || '',
    r.typeLabel || '',
    r.workName || '',
    r.roleType === 'course' ? r.coachRole || '教練' : '',
    r.roleType === 'course' ? r.courseType || '' : '',
    r.startTime || '',
    r.endTime || '',
    (r.roleType === 'course' && r.registeredCount) || '',
    r.roleType === 'course' ? (r.courseHours || 0).toFixed(2) : (r.hours || 0).toFixed(1),
    r.payCalc.formula || '',
    Math.round(r.payCalc.amount || 0),
  ]);
  const csv = [[...CSV_HEADER], ...body].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  return { csv, count: picked.length, note: f.kind === 'all' ? `（共 ${picked.length} 筆）` : `（篩選中：僅 ${picked.length} 筆）` };
}

export const PAYROLL_CHECKLIST: readonly { key: string; title: string; hint: string }[] = [
  { key: 'rates', title: '已填入費率', hint: '課程費率矩陣 / 救生 / 櫃台' },
  { key: 'roster', title: '名冊外教練（★）已確認身分', hint: '按姓名計薪、待人資綁定' },
  { key: 'ctype', title: '課程分類已確認', hint: '補習班辦的游泳、玩水班、高階游泳等' },
  { key: 'longshift', title: '異常長班 / 跨午夜班已核對', hint: '單班 >13h 或收班 00:00' },
  { key: 'dupid', title: '同名重複 ID 已合併', hint: '避免同一人重複計薪' },
  { key: 'venue', title: '其他場館是否納入已決定', hint: '竹科 / 松山等非三館班表' },
];

export function checklistProgress(done: ReadonlySet<string>): { done: number; total: number; pct: number; text: string } {
  const n = PAYROLL_CHECKLIST.filter(i => done.has(i.key)).length;
  const total = PAYROLL_CHECKLIST.length;
  return { done: n, total, pct: (n / total) * 100, text: `${n} / ${total}` };
}

const blankZero = (n: number) => (n ? String(n) : '');

export function typeSummaryCells(r: TypeSummaryRow, isTotal: boolean): string[] {
  if (isTotal) return ['合計', '', `${r.weekday}`, `${r.holiday}`, `${r.manual}`, `${r.total}`, `${r.lead}`, `${r.assist}`, `${r.follow}`, r.hours.toFixed(1)];
  return [r.type, r.hoursPerSession.toFixed(2), blankZero(r.weekday), blankZero(r.holiday), blankZero(r.manual), `${r.total}`, blankZero(r.lead), blankZero(r.assist), blankZero(r.follow), r.hours.toFixed(1)];
}

export interface StaffTable {
  rows: { stats: StaffStats; name: string; star: boolean; counts: (number | null)[]; memo: string; hours: string; pay: string }[];
  total: { counts: number[]; memo: string; hours: string; pay: string } | null;
}

export function staffTable(stats: readonly StaffStats[], config: PayrollConfig): StaffTable {
  const types = courseTypes(config);
  const sorted = sortStaff(stats);
  if (!sorted.length) return { rows: [], total: null };
  const roleTot = { 當班下: 0, 助教: 0, 跟課: 0 };
  const roleHTot = { 當班下: 0, 助教: 0, 跟課: 0 };
  let hours = 0;
  let pay = 0;
  const rows = sorted.map(s => {
    SUB_ROLES.forEach(r => {
      roleTot[r] += s.roleCount[r];
      roleHTot[r] += s.roleHours[r];
    });
    hours += staffTotalHours(s);
    pay += s.pay;
    return {
      stats: s,
      name: s.employeeName,
      star: !s.inRoster,
      counts: types.map(t => s.typeCount.get(t) || null),
      memo: roleMemo(s),
      hours: staffTotalHours(s).toFixed(1),
      pay: moneyText(s.pay),
    };
  });
  return {
    rows,
    total: {
      counts: types.map(t => sorted.reduce((n, s) => n + (s.typeCount.get(t) || 0), 0)),
      memo: `＊${roleTot.當班下}(${roleHTot.當班下.toFixed(1)}h)　a${roleTot.助教}(${roleHTot.助教.toFixed(1)}h)　跟${roleTot.跟課}(${roleHTot.跟課.toFixed(1)}h)`,
      hours: hours.toFixed(1),
      pay: moneyText(pay),
    },
  };
}

export const PAYROLL_EMPTY = {
  staff: '目前本週沒有可統計的排班資料。',
  coachFiltered: '查無符合的教練課程排班。',
  coach: '目前本週沒有課程排班。',
  detailFiltered: '這位教練本週沒有排班明細。',
  detail: '目前本週沒有可統計的排班明細。',
} as const;
