import { dayName } from './dates';
import { employeeKey, type PayrollRow } from './payroll';
import { groupIssues, type Issue, type IssueGroup } from './validate';

export type MobilePill = { className: 'manual' | 'lifeguard' | 'frontdesk' | ''; label: '手動課程' | '課程' | '救生' | '櫃台' };

export function mobilePill(row: Pick<PayrollRow, 'roleType' | 'source'>): MobilePill {
  if (row.roleType === 'course') return row.source === 'manual' ? { className: 'manual', label: '手動課程' } : { className: '', label: '課程' };
  return row.roleType === 'lifeguard' ? { className: 'lifeguard', label: '救生' } : { className: 'frontdesk', label: '櫃台' };
}

export function mobileSummary(rows: readonly PayrollRow[], issues: readonly Issue[]): { label: string; value: string }[] {
  const hoursOf = (pred: (r: PayrollRow) => boolean) => rows.filter(pred).reduce((s, r) => s + (r.hours || 0), 0);
  return [
    { label: '本週員工', value: `${new Set(rows.map(employeeKey)).size} 人` },
    { label: '課程 / 手動課', value: `${rows.filter(r => r.roleType === 'course').length} 堂` },
    { label: '救生 / 櫃台時數', value: `${hoursOf(r => r.roleType === 'lifeguard').toFixed(1)} / ${hoursOf(r => r.roleType === 'frontdesk').toFixed(1)} 小時` },
    { label: '總時數 / 問題', value: `${hoursOf(() => true).toFixed(1)} 小時｜${issues.length} 項` },
  ];
}

export const mobileIssueGroups = (issues: readonly Issue[]): IssueGroup[] => groupIssues(issues, 8);

export interface MobileWork {
  row: PayrollRow;
  pill: MobilePill;
  title: string;
  detail: string;
  calc: string;
  employee: string;
}

const calcText = (r: PayrollRow) => `計算：${r.roleType === 'course' ? '1 堂' : `${r.hours.toFixed(1)} 小時`}`;
const workTitle = (r: PayrollRow) => r.workName || r.courseName || mobilePill(r).label;

export function mobileDays(rows: readonly PayrollRow[]): { title: string; items: MobileWork[] }[] {
  const byDate = new Map<string, PayrollRow[]>();
  rows.forEach(r => {
    const key = r.date || '未指定日期';
    byDate.set(key, [...(byDate.get(key) ?? []), r]);
  });
  return [...byDate.keys()].sort().map(date => {
    const list = byDate.get(date)!;
    return {
      title: `${date}${list[0]?.day ? `｜週${dayName(list[0].day)}` : ''}`,
      items: [...list]
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
        .map(r => ({
          row: r,
          pill: mobilePill(r),
          title: `${r.startTime || ''}-${r.endTime || ''}｜${r.venueName || ''}`,
          detail: `${workTitle(r)}${r.roleType === 'course' && r.registeredCount ? `｜${r.registeredCount}人` : ''}`,
          calc: calcText(r),
          employee: `員工：${r.employeeName || '未指定員工'}`,
        })),
    };
  });
}

export function mobileEmployees(rows: readonly PayrollRow[]): { name: string; lineBound: boolean; items: MobileWork[] }[] {
  const byEmp = new Map<string, { name: string; lineBound: boolean; rows: PayrollRow[] }>();
  rows.forEach(r => {
    const key = employeeKey(r);
    if (!byEmp.has(key)) byEmp.set(key, { name: r.employeeName || '未指定員工', lineBound: !!r.lineBound, rows: [] });
    byEmp.get(key)!.rows.push(r);
  });
  return [...byEmp.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    .map(e => ({
      name: e.name,
      lineBound: e.lineBound,
      items: [...e.rows]
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
        .map(r => ({
          row: r,
          pill: mobilePill(r),
          title: `${r.date || ''} ${r.startTime || ''}-${r.endTime || ''}`,
          detail: `${r.venueName || ''}｜${workTitle(r)}`,
          calc: calcText(r),
          employee: `員工：${r.employeeName || '未指定員工'}`,
        })),
    }));
}

export const MOBILE_EMPTY = { issues: '目前尚無問題。', days: '本週尚無班表資料。', employees: '本週尚無個人班表資料。' } as const;
