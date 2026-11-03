import { isWeekNo, weekByNo } from '../config';
import { normalizeEnrollmentItems } from '../enrollment';
import { normalizeManualCourse } from '../manual-course';
import { draftFromRawEntries } from '../payload';
import { normalizeEmployee } from '../roster';
import type { Employee, EnrollmentState, NameAliases } from '../types';
import { buildWeekModel, type WeekInput } from '../week-model';

type Rec = Record<string, unknown>;

export interface PipelineFixture {
  weekNo: number;
  employees: Rec[];
  rawEntries: Rec[];
  enrollment: { status: number; items?: Rec[]; lastUpdated?: string };
  manualCourses: Rec[];
  payrollConfig: { nameAliases?: Record<string, string> } | null;
}

export function employeesFrom(raw: readonly Rec[]): Employee[] {
  return raw.map(normalizeEmployee).filter((e): e is Employee => e !== null);
}

export function weekInputFrom(fx: PipelineFixture): WeekInput {
  if (!isWeekNo(fx.weekNo)) throw new Error(`bad week ${fx.weekNo}`);
  const week = weekByNo(fx.weekNo);
  const enrollment: EnrollmentState =
    fx.enrollment.status === 200
      ? { kind: 'loaded', weekNo: week.no, items: normalizeEnrollmentItems(fx.enrollment.items ?? [], week.no), lastUpdated: fx.enrollment.lastUpdated ?? null }
      : { kind: 'failed', message: fx.enrollment.status === 401 ? '請先登入管理後台' : '報名人數 API 讀取失敗' };
  const aliases: NameAliases = fx.payrollConfig?.nameAliases ?? {};
  return {
    week,
    draft: draftFromRawEntries(fx.rawEntries),
    employees: employeesFrom(fx.employees),
    aliases,
    manualCourses: fx.manualCourses.map(r => normalizeManualCourse(r, week.no)),
    enrollment,
  };
}

export const modelFrom = (fx: PipelineFixture) => buildWeekModel(weekInputFrom(fx));

export function byKey<T extends { key: string }>(rows: readonly T[]): Record<string, Omit<T, 'key'>> {
  return Object.fromEntries([...rows].sort((a, b) => a.key.localeCompare(b.key)).map(({ key, ...rest }) => [key, rest]));
}
