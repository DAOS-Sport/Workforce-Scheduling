import type { Draft, Employee, EmployeeId, EmployeeMeta, NameAliases } from './types';

export interface Roster {
  employees: readonly Employee[];
  names: ReadonlySet<string>;
  byId(id: EmployeeId | ''): Employee | undefined;
  byName(name: string): Employee | undefined;
}

export interface ParseContext {
  roster: Roster;
  aliases: NameAliases;
  meta: Draft['meta'];
}

export function createRoster(employees: readonly Employee[]): Roster {
  return {
    employees,
    names: new Set(employees.map(e => String(e.name || '').trim()).filter(Boolean)),
    byId: id => employees.find(e => String(e.id) === String(id)),
    byName: name => employees.find(e => e.name === String(name || '').trim()),
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function normalizeEmployee(raw: Record<string, unknown>): Employee | null {
  const id = raw.id;
  if (!id || (typeof id !== 'number' && typeof id !== 'string')) return null;
  const venueId = raw.venueId;
  return {
    id,
    name: str(raw.name) || '',
    role: str(raw.role) || '',
    venueId: typeof venueId === 'number' || typeof venueId === 'string' ? venueId : '',
    venueName: str(raw.venueName) || str(raw.venue) || '',
    lineBound: !!raw.lineBound,
    lineDisplayName: str(raw.lineDisplayName) || '',
    lineBoundAt: str(raw.lineBoundAt) || '',
  };
}

export function isLineBound(emp: { lineBound?: unknown } | null | undefined): boolean {
  return !!emp && !!emp.lineBound;
}

export function displayNameWithLineStatus(emp: { name?: string; employeeName?: string; lineBound?: unknown } | null | undefined): string {
  if (!emp) return '';
  const name = String(emp.name || emp.employeeName || '').trim();
  if (!name) return '';
  return isLineBound(emp) ? name : `${name}（未綁定）`;
}

export function lineBadgeText(emp: { lineBound?: unknown }): string {
  return isLineBound(emp) ? '已綁定 LINE' : '未綁定 LINE';
}

export function employeeLabel(emp: Employee): string {
  return `${emp.name}｜${emp.role}｜${emp.venueName || ''}｜${lineBadgeText(emp)}`;
}

export interface ResolvedEmployee {
  id: EmployeeId;
  name: string;
  role: string;
  lineBound: boolean;
}

export function findEmployeeForLine(ctx: Pick<ParseContext, 'roster' | 'meta'>, name: string, key: string): ResolvedEmployee | undefined {
  const byMeta = (ctx.meta.get(key) ?? []).find(m => m.employeeName === name || String(m.employeeId) === String(name));
  if (byMeta) {
    return ctx.roster.byId(byMeta.employeeId) ?? { id: byMeta.employeeId, name: byMeta.employeeName, role: byMeta.role, lineBound: !!byMeta.lineBound };
  }
  return ctx.roster.byName(name);
}

export interface PickerEntry {
  id: EmployeeId;
  main: string;
  sub: string;
  bound: boolean;
}

export type PickerList = { kind: 'roster-empty' } | { kind: 'no-match' } | { kind: 'entries'; entries: PickerEntry[] };

export function pickerList(roster: Roster, query: string): PickerList {
  if (!roster.employees.length) return { kind: 'roster-empty' };
  const q = String(query || '').trim().toLowerCase();
  const entries = sortBoundFirst(roster.employees)
    .filter(e => !q || [e.name, e.role, e.venueName, e.lineDisplayName].join(' ').toLowerCase().includes(q))
    .map(e => ({
      id: e.id,
      main: `${e.name}｜${e.role}｜${e.venueName || ''}`,
      sub: `LINE：${isLineBound(e) ? e.lineDisplayName || '已綁定' : '尚未綁定'}`,
      bound: isLineBound(e),
    }));
  return entries.length ? { kind: 'entries', entries } : { kind: 'no-match' };
}

export function sortBoundFirst(employees: readonly Employee[]): Employee[] {
  return [...employees].sort((a, b) => Number(isLineBound(b)) - Number(isLineBound(a)) || a.name.localeCompare(b.name, 'zh-Hant'));
}

export function metaFor(emp: Employee): EmployeeMeta {
  return { employeeId: emp.id, employeeName: emp.name, lineBound: isLineBound(emp), role: emp.role, venueId: emp.venueId || '', venueName: emp.venueName || '' };
}

export const EMPLOYEE_MESSAGES = {
  notLoaded: '尚未取得員工資料',
  unauthorized: '請先登入管理後台，再重新開啟暑假排班表',
  failed: '員工資料讀取失敗，請確認 /api/admin/summer-employees 是否正常',
  empty: '目前沒有可排班的啟用員工，或 API 回傳格式沒有 items',
  noMatch: '查無員工',
} as const;
