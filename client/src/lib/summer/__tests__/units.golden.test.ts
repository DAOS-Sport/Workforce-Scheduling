import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/v40-golden.json';
import { extractApiItems, extractApiMeta, unwrapApiPayload } from '../api-shape';
import { VENUES, WEEKS, weekOptions } from '../config';
import { datesInWeek, dayName, dayNoOf, formatManualDate, formatUpdatedTime, isIsoDate, isoDateForWeekDay, parseManualDates, weekNoForDate } from '../dates';
import { enrollmentLookupKeys, normalizeCourseNameForEnrollment, normalizeEnrollmentItems } from '../enrollment';
import { normalizeManualCourse } from '../manual-course';
import {
  activeDaysForPeriod,
  assignmentIdentity,
  cleanEmployeeDisplayName,
  coachRoleOf,
  compactTimeLabel,
  countAssignmentsByDay,
  countDistinctAssignees,
  duplicateNames,
  dutyPeriodForDay,
  htmlToCellText,
  minutesToTime,
  normalizeName,
  parseAssignments,
  parseDutyGridLines,
  parseLooseTimeRange,
  parseTimeRange,
  roleMarkerFromLine,
  slug,
  splitCoachLineParts,
  splitCoachNames,
  timesOverlap,
  tokenizeCoachLine,
  usefulLines,
  venueIdByName,
} from '../parse';
import { hasScheduleValue, hasShiftRows, hasWorkRows, notesForShift, rawEntryHasScheduleValue } from '../payload';
import { createRoster, displayNameWithLineStatus, employeeLabel, isLineBound, normalizeEmployee } from '../roster';
import type { CoursePeriod, DayNo, DutyRole, Employee, NormalizedAssignment, RawEntry } from '../types';
import { classifyIssue, ISSUE_GROUPS } from '../validate';
import { employeesFrom } from './golden';

type Case = { args: unknown[]; result: unknown };
type Spec = { employees?: Record<string, unknown>[]; pvConfig?: { nameAliases?: Record<string, string> } };
const units = golden.units as unknown as Record<string, Case[]>;
const specs: Record<string, Spec> = {
  splitCoachLineParts: { pvConfig: { nameAliases: { 莊子宏: '莊子鋐', 陳美玲跟課: '陳美', 王小明: '王偉' } } },
  parseAssignments: { pvConfig: { nameAliases: { 莊子宏: '莊子鋐', 陳美玲跟課: '陳美', 王小明: '王偉' } } },
};
const scenarioEmployees = employeesFrom((golden.pipelines[0] as unknown as { fx: { employees: Record<string, unknown>[] } }).fx.employees);
const aliases = specs.parseAssignments.pvConfig!.nameAliases!;
const ctx = (employees: readonly Employee[] = scenarioEmployees) => ({ roster: createRoster(employees), aliases, meta: new Map() });
const week = (i: unknown) => WEEKS[Number(i)];

function cases(group: string) {
  const list = units[group];
  if (!list?.length) throw new Error(`golden has no cases for ${group}`);
  return list.map((c, i) => [`#${i} ${JSON.stringify(c.args).slice(0, 60)}`, c.args, c.result] as const);
}

const s = (v: unknown) => v as string;
const n = (v: unknown) => v as number;

describe('weeks and venues (R001, R047, R220)', () => {
  it('nine week rows equal v40 including labels (R001, R220)', () => {
    const [[, , result]] = cases('weeks');
    const v40 = result as (Record<string, unknown> & { optionValue: string })[];
    expect(WEEKS.map(w => ({ ...w, activeWeekdays: [...w.activeWeekdays] }))).toStrictEqual(v40.map(({ optionValue: _, ...w }) => w));
    expect(weekOptions()).toStrictEqual(v40.map(w => ({ value: w.optionValue, label: w.label })));
  });

  it('venue table equals v40 (R047, R084)', () => {
    const [[, , result]] = cases('venues');
    const v40 = (result as Record<string, unknown>[]).map(v => ({
      ...v,
      holidayCourses: (v.holidayCourses as Record<string, unknown>[]).map(({ defaultNote: _, ...c }) => c),
    }));
    expect(JSON.parse(JSON.stringify(VENUES))).toStrictEqual(v40);
  });
});

describe('time and text parsing (R025-R034, R043-R045)', () => {
  it.each(cases('parseTimeRange'))('parseTimeRange %s (R025)', (_n, a, r) => expect(parseTimeRange(s(a[0]))).toStrictEqual(r));
  it.each(cases('parseLooseTimeRange'))('parseLooseTimeRange %s (R026)', (_n, a, r) => expect(parseLooseTimeRange(s(a[0]))).toStrictEqual(r));
  it.each(cases('compactTimeLabel'))('compactTimeLabel %s (R027, R194)', (_n, a, r) => expect(compactTimeLabel(s(a[0]))).toBe(r));
  it.each(cases('timesOverlap'))('timesOverlap %s (R028)', (_n, a, r) =>
    expect(timesOverlap(a[0] as { start: number; end: number } | null, a[1] as { start: number; end: number })).toBe(r),
  );
  it.each(cases('normalizeName'))('normalizeName %s (R029)', (_n, a, r) => expect(normalizeName(s(a[0]))).toBe(r));
  it.each(cases('activeDaysForPeriod'))('activeDaysForPeriod %s (R030)', (_n, a, r) => expect(activeDaysForPeriod(s(a[0]), week(a[1]))).toStrictEqual(r));
  it.each(cases('dutyPeriodForDay'))('dutyPeriodForDay %s (R030)', (_n, a, r) => expect(dutyPeriodForDay(Number(a[0]))).toBe(r));
  it.each(cases('dayName'))('dayName %s (R030)', (_n, a, r) => expect(dayName(n(a[0]))).toBe(String(r)));
  it.each(cases('datesInWeek'))('datesInWeek %s (R031, R225)', (_n, a, r) => expect(datesInWeek(week(a[0]))).toStrictEqual(r));
  it.each(cases('usefulLines'))('usefulLines %s (R032)', (_n, a, r) => expect(usefulLines(s(a[0]))).toStrictEqual(r));
  it.each(cases('cleanEmployeeDisplayName'))('cleanEmployeeDisplayName %s (R012)', (_n, a, r) => expect(cleanEmployeeDisplayName(s(a[0]))).toBe(r));
  it.each(cases('roleMarkerFromLine'))('roleMarkerFromLine %s (R034)', (_n, a, r) => expect(roleMarkerFromLine(s(a[0]))).toBe(r));
  it.each(cases('slug'))('slug %s (R043)', (_n, a, r) => expect(slug(s(a[0]))).toBe(r));
  it.each(cases('venueIdByName'))('venueIdByName %s (R044)', (_n, a, r) => expect(venueIdByName(s(a[0]))).toBe(r));
  it.each(cases('boxText'))('htmlToCellText %s (R045)', (_n, a, r) => expect(htmlToCellText(s(a[0]))).toBe(r));
  it.each(cases('minutesToTime'))('minutesToTime %s (R233)', (_n, a, r) => expect(minutesToTime(n(a[0]))).toBe(r));
});

describe('coach line parsing (R013, R036-R041)', () => {
  it.each(cases('splitCoachLineParts'))('splitCoachLineParts %s (R013)', (_n, a, r) => expect(splitCoachLineParts(s(a[0]), aliases)).toStrictEqual(r));
  it.each(cases('tokenizeCoachLine'))('tokenizeCoachLine %s (R037)', (_n, a, r) => expect(tokenizeCoachLine(s(a[0]))).toStrictEqual(r));
  it.each(cases('splitCoachNames'))('splitCoachNames %s (R036)', (_n, a, r) => {
    const names = new Set(['陳美', '王偉', '美王', '陳美王偉']);
    expect(splitCoachNames(s(a[0]), names)).toStrictEqual(r);
  });
  it.each(cases('splitCoachNamesEmptyRoster'))('splitCoachNames without roster %s (R036)', (_n, a, r) => expect(splitCoachNames(s(a[0]), new Set())).toStrictEqual(r));
  it.each(cases('coachRoleOf'))('coachRoleOf %s (R038)', (_n, a, r) => expect(coachRoleOf(s(a[0]), !!a[1])).toBe(r));
  it.each(cases('parseAssignments'))('parseAssignments %s (R039, R040)', (_n, a, r) => {
    const v40 = (r as Record<string, unknown>[]).map(({ employeeVenue: _, ...x }) => x);
    expect(parseAssignments(ctx(), s(a[0]), a[1] as CoursePeriod, week(a[2]))).toStrictEqual(v40);
  });
  it.each(cases('duplicateAndCounts'))('duplicates, per-day and single counts %s (R041)', (_n, a, r) => {
    const period = a[1] as CoursePeriod;
    const list = parseAssignments(ctx(), s(a[0]), period, week(a[2]));
    const byDay = Object.fromEntries(Array.from(countAssignmentsByDay(list, activeDaysForPeriod(period, week(a[2]))), ([d, c]) => [String(d), c]));
    expect({ dups: duplicateNames(list), byDay, single: countDistinctAssignees(list), ids: list.map(assignmentIdentity) }).toStrictEqual(r);
  });
  it.each(cases('parseDutyGridLines'))('parseDutyGridLines %s (R035)', (_n, a, r) => {
    const v40 = (r as Record<string, unknown>[]).map(({ venueId: _v, period: _p, ...x }) => x);
    const mine = parseDutyGridLines(ctx(), s(a[0]), a[1] as DutyRole, n(a[2]) as DayNo).map(({ dayNo, ...x }) => ({ ...x, days: [dayNo], dayNo }));
    expect(mine).toStrictEqual(v40.map(x => ({ name: x.name, employeeId: x.employeeId, lineBound: x.lineBound, role: x.role, time: x.time, raw: x.raw, days: x.days, dayNo: x.dayNo })));
  });
});

describe('employees and LINE status (R009-R012, R017)', () => {
  it.each(cases('employeeNormalize'))('normalizeEmployee %s (R009)', (_n, a, r) => {
    const v40 = r as Record<string, unknown>;
    expect(normalizeEmployee(a[0] as Record<string, unknown>)).toStrictEqual(v40.id ? v40 : null);
  });

  const lineCases = cases('lineBound');
  it.each(lineCases.filter((_c, i) => ![0, 4].includes(i)))('display name follows lineBound %s (R010, R011)', (_n, a, r) => {
    const v40 = r as { simple: boolean; display: string };
    const emp = a[0] as { lineBound?: unknown } | null;
    expect({ simple: isLineBound(emp), display: displayNameWithLineStatus(emp as { name?: string }) }).toStrictEqual({ simple: v40.simple, display: v40.display });
  });
  it('與 v40 不同：顯示名的 LINE 綁定只看 lineBound，不看 lineDisplayName 或 lineUserId（R010）', () => {
    const [first, , , , fifth] = lineCases;
    expect((first[2] as { display: string }).display).toBe('王偉');
    expect(displayNameWithLineStatus(first[1][0] as { name: string })).toBe('王偉（未綁定）');
    expect((fifth[2] as { display: string }).display).toBe('陳');
    expect(displayNameWithLineStatus(fifth[1][0] as { employeeName: string })).toBe('陳（未綁定）');
  });
  it.each(cases('employeeLabel'))('employeeLabel %s (R017)', (_n, a, r) => {
    const raw = a[0] as Record<string, unknown>;
    expect(employeeLabel(normalizeEmployee({ id: 1, ...raw })!)).toBe(r);
  });
});

describe('API response unwrapping (R005-R007)', () => {
  it.each(cases('unwrapApiPayload'))('unwrapApiPayload %s (R005)', (_n, a, r) => expect(unwrapApiPayload(a[0])).toStrictEqual(r));
  it.each(cases('extractApiItems'))('extractApiItems %s (R006)', (_n, a, r) => expect(extractApiItems(a[0])).toStrictEqual(r));
  it.each(cases('extractApiMeta'))('extractApiMeta %s (R007)', (_n, a, r) => expect(extractApiMeta(a[0])).toStrictEqual(r));
});

describe('enrollment keys (R049-R051)', () => {
  it.each(cases('normalizeCourseNameForEnrollment'))('normalizeCourseNameForEnrollment %s (R049)', (_n, a, r) => expect(normalizeCourseNameForEnrollment(s(a[0]))).toBe(r));
  it.each(cases('enrollmentLookupKeysForRow'))('enrollmentLookupKeys %s (R050)', (_n, a, r) =>
    expect(enrollmentLookupKeys(n(a[0]), a[1] as string, s(a[2]), s(a[3]), a[4] === 'holiday' ? 'holiday' : 'weekday')).toStrictEqual(r),
  );
  it.each(cases('normalizeEnrollmentItemFromApi'))('normalizeEnrollmentItems drops rows missing a key part %s (R051)', (_n, a, r) => {
    const v40 = r as { weekNo: number; venueId: string; courseName: string; slotCode: string };
    const usable = v40.weekNo && v40.venueId && v40.courseName && v40.slotCode;
    expect(normalizeEnrollmentItems([a[0] as Record<string, unknown>], n(a[1]))).toStrictEqual(usable ? [v40] : []);
  });
});

describe('manual course dates (R065-R067, R077)', () => {
  const dateCases = cases('parseManualDates');
  const rangeFix: Record<number, string[]> = {
    5: ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'],
    6: ['2026-07-01', '2026-07-02'],
    7: ['2026-08-29', '2026-08-30'],
  };
  it.each(dateCases.filter((_c, i) => !(i in rangeFix)))('parseManualDates %s (R065)', (_n, a, r) => expect(parseManualDates(s(a[0]), n(a[1]))).toStrictEqual(r));
  it.each(Object.entries(rangeFix).map(([i, want]) => [dateCases[Number(i)][1][0], dateCases[Number(i)], want] as const))(
    '與 v40 不同：日期範圍 %s 不因時區前移一天（R066）',
    (_label, [, a, v40], want) => {
      expect(v40).not.toStrictEqual(want);
      expect(parseManualDates(s(a[0]), n(a[1]))).toStrictEqual(want);
    },
  );
  it.each(cases('manualDateHelpers'))('week, weekday and label of a date %s (R067)', (_n, a, r) => {
    const d = s(a[0]);
    expect({ week: weekNoForDate(d), day: isIsoDate(d) ? dayNoOf(d) : null, label: formatManualDate(d) }).toStrictEqual(r);
  });
  const manualCases = cases('normalizeManualCourseRow');
  it('normalizeManualCourse without coach fields equals v40, a missing date parses as empty text (R077)', () => {
    const [, a, r] = manualCases[1];
    expect(r).not.toHaveProperty('date');
    expect(normalizeManualCourse(a[0] as Record<string, unknown>, n(a[1]))).toStrictEqual({ ...(r as object), date: '' });
  });
  it('與 v40 不同：正規化保留手動課程的 employeeId / employeeName（R074）', () => {
    const [, a, r] = manualCases[0];
    expect(r).not.toHaveProperty('employeeId');
    expect(normalizeManualCourse(a[0] as Record<string, unknown>, n(a[1]))).toStrictEqual({ ...(r as object), employeeId: 9, employeeName: '王偉' });
  });
});

describe('shift helpers (R098, R108, R109, R231)', () => {
  it.each(cases('isoDateForWeekDay'))('isoDateForWeekDay %s (R109)', (_n, a, r) => expect(isoDateForWeekDay(week(a[0]), n(a[1]))).toBe(r));
  it.each(cases('notesForShift'))('notesForShift %s (R108)', (_n, a, r) => expect(notesForShift(a[0] as NormalizedAssignment)).toBe(r));
  it.each(cases('rawEntryHasScheduleValue'))('rawEntryHasScheduleValue %s (R098)', (_n, a, r) =>
    expect(rawEntryHasScheduleValue({ employees: [], ...(a[0] as object) } as unknown as RawEntry)).toBe(r),
  );
  it.each(cases('payloadRows'))('payload row checks %s (R231)', (_n, a, r) => {
    const p = a[0] as Parameters<typeof hasShiftRows>[0];
    const fixed = { ...p, rawEntries: (p.rawEntries ?? []).map(e => ({ ...e, employees: e.employees ?? [] })) };
    expect({ shift: hasShiftRows(fixed), work: hasWorkRows(fixed), value: hasScheduleValue(fixed) }).toStrictEqual(r);
  });
});

describe('issues and time labels (R059, R091, R229)', () => {
  it.each(cases('classifyIssue'))('classifyIssue with group label and hint %s (R091, R229)', (_n, a, r) => {
    const type = classifyIssue(s(a[0]));
    const group = ISSUE_GROUPS.find(g => g.type === type)!;
    expect({ type, label: group.label, hint: group.hint }).toStrictEqual(r);
  });
  it.each(cases('formatUpdatedTime'))('formatUpdatedTime %s (R059)', (_n, a, r) => expect(formatUpdatedTime(a[0] as string | null)).toBe(r));
});
