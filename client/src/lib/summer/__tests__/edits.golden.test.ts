import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/v40-golden.json';
import { subtractIntervals } from '../availability';
import { applyPickedEmployee, applyTempCoach, normalizeCoachCellText, removeCoach, removeDutyLine } from '../cell-edits';
import { WEEKS } from '../config';
import { normalizeCellText } from '../parse';
import { draftFromRawEntries } from '../payload';
import {
  classifyCourseType,
  courseDurationHours,
  courseTypes,
  cramSchools,
  durationHours,
  EMPTY_PAYROLL_CONFIG,
  employeeKey,
  hoursOf,
  isCramCourse,
  moneyText,
  roleTypeClass,
  roleTypeLabel,
  salaryRateTarget,
  type PayrollConfig,
} from '../payroll';
import { createRoster, EMPLOYEE_MESSAGES, pickerList } from '../roster';
import { gapAssignment, selectedDayLabel, selectedDayNo, type StageDay } from '../stage';
import type { DayNo, DutyRole, EmployeeMeta, NormalizedAssignment, VenueName } from '../types';
import { venueTextMatches, workLabel } from '../validate';
import { buildWeekModel } from '../week-model';
import { employeesFrom } from './golden';

type Case = { args: unknown[]; result: unknown };
const units = golden.units as unknown as Record<string, Case[]>;
const fx = golden.pipelines[0] as unknown as { fx: { employees: Record<string, unknown>[]; payrollConfig: { nameAliases: Record<string, string> } } };
const employees = employeesFrom(fx.fx.employees);
const roster = createRoster(employees);
const aliases = { 莊子宏: '莊子鋐', 陳美玲跟課: '陳美', 王小明: '王偉' };

function cases(group: string, skip: readonly number[] = []) {
  const list = units[group];
  if (!list?.length) throw new Error(`golden has no cases for ${group}`);
  return list.map((c, i) => [`#${i} ${JSON.stringify(c.args).slice(0, 50)}`, c.args, c.result, i] as const).filter(c => !skip.includes(c[3]));
}
const s = (v: unknown) => v as string;
const metaOf = (ids: number[]): EmployeeMeta[] => ids.map(id => ({ employeeId: id, employeeName: `m${id}`, lineBound: false, role: '', venueId: '', venueName: '' }));
const target = (gap: unknown) => (gap ? { kind: 'gap' as const, timeLabel: s(gap) } : { kind: 'course' as const });

describe('picking and typing coaches into a cell (R020-R022)', () => {
  const pick = (a: readonly unknown[]) => {
    const r = applyPickedEmployee(s(a[0]), metaOf(a[1] as number[]), roster.byId(a[2] as number)!, target(a[3]), roster);
    return { value: r.value, meta: [...r.employees] };
  };
  it.each(cases('pickEmployee', [2, 6]))('picked employee %s (R020, R021)', (_n, a, r) => expect(pick(a)).toStrictEqual(r));
  it('與 v40 不同：已排判斷只認完整姓名，「陳美玲」不會擋住排「陳美」（R020）', () => {
    const [, a, r] = cases('pickEmployee')[2];
    expect((r as { value: string }).value).toBe('陳美玲');
    expect(pick(a).value).toBe('陳美玲\n陳美（未綁定）');
  });
  it('與 v40 不同：缺口排班的顯示名依 lineBound 加上（未綁定）（R010, R021）', () => {
    const [, a, r] = cases('pickEmployee')[6];
    expect((r as { value: string }).value).toBe('陳美 救0800-1000');
    expect(pick(a)).toStrictEqual({ ...(r as object), value: '陳美（未綁定） 救0800-1000' });
  });
  it.each(cases('tempCoach'))('temporary coach %s (R022)', (_n, a, r) => {
    const e = applyTempCoach(s(a[0]), [], s(a[1]).trim(), target(a[2]));
    expect({ value: e.value, meta: [...e.employees] }).toStrictEqual(r);
  });
  it.each(cases('pickerList'))('picker list order, search and labels %s (R019)', (_n, a, r) => {
    const list = pickerList(roster, s(a[0]));
    const mine = list.kind === 'entries' ? list.entries.map(e => ({ main: e.main, sub: e.sub })) : [{ empty: list.kind === 'no-match' ? EMPLOYEE_MESSAGES.noMatch : EMPLOYEE_MESSAGES.notLoaded }];
    expect(mine).toStrictEqual(r);
  });
  it('an empty roster shows the employee API message instead of a list (R015, R019)', () => {
    expect(pickerList(createRoster([]), '')).toStrictEqual({ kind: 'roster-empty' });
    expect(units.pickerListEmpty[0].result).toBe(EMPLOYEE_MESSAGES.empty);
  });
});

describe('removing lines and coaches (R195, R196)', () => {
  it.each(cases('removeLine'))('removeDutyLine %s (R195)', (_n, a, r) => expect(removeDutyLine(s(a[0]), s(a[1])) ?? s(a[0])).toBe(r));
  it.each(cases('removeCoach'))('removeCoach %s (R196)', (_n, a, r) => {
    const names = createRoster(employeesFrom([{ id: 1, name: '陳美' }, { id: 2, name: '王偉' }, { id: 3, name: '莊柏彥' }, { id: 4, name: '劉承翰' }]));
    expect(removeCoach(s(a[0]), s(a[1]), names)).toBe(r);
  });
});

describe('coach cell name normalization (R014)', () => {
  const list = cases('normalizeCoachCells', [6, 7]);
  it.each(list)('normalizeCoachCellText %s (R014)', (_n, a, r) => expect(normalizeCoachCellText(normalizeCellText(s(a[0])), roster, aliases)).toBe(r));
  it('與 v40 不同：未綁 LINE 但留有 lineDisplayName 的員工會加上（未綁定）（R010, R014）', () => {
    const all = cases('normalizeCoachCells');
    expect([all[6][2], all[7][2]]).toStrictEqual(['陳美\n李四3', '陳美']);
    expect(normalizeCoachCellText(normalizeCellText(s(all[6][1][0])), roster, aliases)).toBe('陳美（未綁定）\n李四3');
    expect(normalizeCoachCellText('陳美', roster, aliases)).toBe('陳美（未綁定）');
  });
});

describe('stage day selection and gap assignment (R173, R174, R194)', () => {
  it.each(cases('stageDay'))('selected day %s (R173, R174)', (_n, a, r) => {
    const week = WEEKS[Number(a[1])];
    const day = selectedDayNo(week, s(a[0]) as StageDay);
    expect([day, selectedDayLabel(week, day)]).toStrictEqual(r);
  });
  it.each(cases('gapAssign'))('gap assignment target cell %s (R042, R194)', (_n, a, r) => {
    const cells = a[0] as Record<string, string>;
    const model = buildWeekModel({
      week: WEEKS[0],
      draft: draftFromRawEntries(Object.entries(cells).map(([key, value]) => ({ key, value }))),
      employees: [],
      aliases: {},
      manualCourses: [],
      enrollment: { kind: 'loading' },
    });
    const g = gapAssignment(model, a[1] as VenueName, a[2] as DutyRole, a[3] as DayNo, s(a[4]));
    const rowsKey = `w1-${a[1]}-${a[2]}-dutygrid-rows`;
    expect({ key: g.targetKey, time: g.timeLabel, title: g.title, rows: g.rowCountUpdate?.value ?? cells[rowsKey] ?? null }).toStrictEqual(r);
  });
});

const cfg = (over: Partial<PayrollConfig>): PayrollConfig => ({ ...EMPTY_PAYROLL_CONFIG, ...over });

describe('payroll helpers (R140-R145, R149-R153, R167)', () => {
  it.each(cases('classifyCourseType'))('classifyCourseType %s (R143)', (_n, a, r) =>
    expect(classifyCourseType(cfg({ typeOverrides: { 夏令營: '球類課程', 錯的: '不存在類型' } }), a[0] as object)).toBe(r),
  );
  it.each(cases('classifyWithCram'))('classifyCourseType with custom lists %s (R142, R143, R144)', (_n, a, r) =>
    expect(classifyCourseType(cfg({ cramSchools: ['新補'], types: ['游泳一般團班', '補習班課程', '體適能'], typeOverrides: { 夏令營: '體適能' } }), a[0] as object)).toBe(r),
  );
  it.each(cases('hoursOf'))('hoursOf %s (R140)', (_n, a, r) =>
    expect(hoursOf(cfg({ hours: { 球類課程: '-1', 補習班課程: '0', 游泳假日班: '', 幼兒游泳班: 'abc', 體適能: '2.5' } }), s(a[0]))).toBe(r),
  );
  it('course type list falls back to the seven defaults (R142)', () => {
    expect(courseTypes(cfg({ types: null }))).toStrictEqual(units.courseTypes[0].result);
    expect(courseTypes(cfg({ types: ['A', 'B'] }))).toStrictEqual(units.courseTypesCustom[0].result);
  });
  it.each(cases('cramSchools'))('cram school list and prefix match %s (R144)', (_n, a, r) => {
    const c = cfg({ cramSchools: [] });
    expect([cramSchools(c), isCramCourse(c, s(a[0]))]).toStrictEqual(r);
  });
  it.each(cases('courseDur'))('PE course duration %s (R145)', (_n, a, r) => expect(courseDurationHours(s(a[0]), s(a[1]))).toBe(r));
  it.each(cases('durationHours'))('durationHours %s (R151)', (_n, a, r) => expect(durationHours(s(a[0]), s(a[1]))).toBe(r));
  it.each(cases('roleTypeLabel'))('role type label and class %s (R152)', (_n, a, r) => {
    const x = { roleType: a[0], source: a[1] } as Pick<NormalizedAssignment, 'roleType' | 'source'>;
    expect([roleTypeLabel(x), roleTypeClass(x)]).toStrictEqual(r);
  });
  it.each(cases('moneyText'))('moneyText %s (R153)', (_n, a, r) => expect(moneyText(Number(a[0]))).toBe(r));
  it.each(cases('employeeKeyForPayroll'))('employee key %s (R149)', (_n, a, r) => expect(employeeKey(a[0] as { employeeId: unknown })).toBe(r));
  it.each(cases('salaryRateTarget'))('salary-rates role mapping %s (R167)', (_n, a, r) => {
    const names: Record<string, string> = { lifeguard: 'rateLifeguard', frontdesk: 'rateFrontdesk', manual: 'rateManual', course: 'rateCourse', '': '' };
    expect(names[salaryRateTarget(a[0] as object)]).toBe(r);
  });
});

describe('availability and conflict helpers (R085, R086, R089, R133)', () => {
  it.each(cases('subtractIntervals'))('subtractIntervals %s (R133)', (_n, a, r) =>
    expect(subtractIntervals(a[0] as { start: number; end: number }, a[1] as { start: number; end: number }[])).toStrictEqual(r),
  );
  it.each(cases('workLabel'))('work label %s (R086)', (_n, a, r) => expect(workLabel(a[0] as Parameters<typeof workLabel>[0])).toBe(r));
  it.each(cases('venueTextMatches'))('venueTextMatches %s (R089)', (_n, a, r) => expect(venueTextMatches(s(a[0]), s(a[1]))).toBe(r));
});
