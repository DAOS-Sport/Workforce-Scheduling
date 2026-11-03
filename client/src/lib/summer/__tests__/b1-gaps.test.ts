import { describe, expect, it } from 'vitest';
import golden from '../__fixtures__/v40-golden.json';
import { availabilityKey, courseCellKey, courseRowId, dutyGridCellKey, dutyGridRowsKey, manualCellKey, manualCourseIdFromCoachKey, overrideKey } from '../cell-key';
import { VENUES, WEEKS, weekByNo, weekOptions } from '../config';
import { enrollmentKey, indexEnrollment } from '../enrollment';
import { buildSavePayload, collectAssignments, collectShiftRows, draftFromRawEntries, rawEntriesFromDraft } from '../payload';
import { EMPTY_MANUAL_FORM, formAfterAdd, MANUAL_COURSE_MESSAGES, validateManualCourseForm } from '../manual-course';
import { createRoster, findEmployeeForLine } from '../roster';
import type { Draft, Employee, EmployeeMeta, EnrollmentItem, WeekNo } from '../types';
import { groupIssues, venueRule, type Issue } from '../validate';
import { employeesFrom, modelFrom, type PipelineFixture } from './golden';

const pipelines = golden.pipelines as unknown as { name: string; fx: PipelineFixture }[];
const scenarioEmployees = pipelines[0].fx.employees;

describe('week lookup (R001)', () => {
  it('returns the configured week by number with its active weekdays and dropdown label (R001)', () => {
    expect(weekByNo(1)).toMatchObject({ no: 1, start: '2026-07-01', end: '2026-07-05', activeWeekdays: [3, 4, 5] });
    expect(weekByNo(2)).toMatchObject({ no: 2, start: '2026-07-06', end: '2026-07-12', activeWeekdays: [1, 2, 3, 4, 5] });
    expect(weekByNo(9)).toMatchObject({ no: 9, start: '2026-08-24', end: '2026-08-30' });
    expect(weekOptions()[0].label).toBe('第一週｜07/01（三）－07/05（日）');
    WEEKS.forEach((w, i) => expect(weekByNo((i + 1) as WeekNo)).toBe(w));
  });

  it('rejects a week number outside the nine configured weeks (R001)', () => {
    expect(() => weekByNo(0 as WeekNo)).toThrow('week 0 is not configured');
    expect(() => weekByNo(10 as WeekNo)).toThrow('week 10 is not configured');
  });
});

describe('employee lookup for a coach line (R018, R023)', () => {
  const emp = (id: number, name: string, over: Partial<Employee> = {}): Employee => ({ id, name, role: '教練', venueId: '', venueName: '', lineBound: false, lineDisplayName: '', lineBoundAt: '', ...over });
  const meta = (employeeId: number, employeeName: string, over: Partial<EmployeeMeta> = {}): EmployeeMeta => ({ employeeId, employeeName, lineBound: false, role: '', venueId: '', venueName: '', ...over });
  const roster = createRoster([emp(7, '王偉', { role: '救生', lineBound: true }), emp(8, '陳美')]);
  const key = 'w2-新北高中-course-一般游泳_6足歲以上-A-weekday';

  const v40Cases = (golden.units as unknown as Record<string, { args: unknown[]; result: unknown }[]>).findEmployeeForLine;
  it.each(v40Cases.map((c, i) => [`#${i} ${JSON.stringify(c.args).slice(0, 50)}`, c.args, c.result] as const))('resolves the same employee as v40 %s (R018, R023)', (_n, args, v40) => {
    const [name, key, rows] = args as [string, string, Partial<EmployeeMeta>[] | null];
    const filled = (rows ?? []).map(r => meta(Number(r.employeeId), String(r.employeeName), r));
    const found = findEmployeeForLine({ roster: createRoster(employeesFrom(scenarioEmployees)), meta: new Map(rows ? [[key, filled]] : []) }, name, key);
    expect(found ? { id: found.id, name: found.name, role: found.role, lineBound: !!found.lineBound } : null).toStrictEqual(v40);
  });

  it('prefers the cell meta: a match by name or by id string resolves to the roster employee with that id (R018, R023)', () => {
    const ctx = { roster, meta: new Map([[key, [meta(7, '舊名字')]]]) };
    expect(findEmployeeForLine(ctx, '舊名字', key)).toBe(roster.byId(7));
    expect(findEmployeeForLine(ctx, '7', key)).toBe(roster.byId(7));
  });

  it('builds the employee from the meta when the roster no longer has that id (R018, R023)', () => {
    const ctx = { roster, meta: new Map([[key, [meta(99, '外聘', { role: '教練', lineBound: true })]]]) };
    expect(findEmployeeForLine(ctx, '外聘', key)).toStrictEqual({ id: 99, name: '外聘', role: '教練', lineBound: true });
  });

  it('falls back to an exact roster name when the cell has no matching meta, and finds nothing otherwise (R018, R023)', () => {
    const ctx = { roster, meta: new Map([[key, [meta(99, '外聘')]]]) };
    expect(findEmployeeForLine(ctx, '陳美', key)).toBe(roster.byName('陳美'));
    expect(findEmployeeForLine(ctx, '陳美', 'w2-other-key')).toBe(roster.byName('陳美'));
    expect(findEmployeeForLine(ctx, '陳', key)).toBeUndefined();
    expect(findEmployeeForLine(ctx, '不存在', key)).toBeUndefined();
  });
});

describe('enrollment index (R051)', () => {
  const item = (slotCode: string, registeredCount: number, over: Partial<EnrollmentItem> = {}): EnrollmentItem => ({
    weekNo: 2,
    venueId: '2',
    courseName: '一般游泳(6足歲以上)',
    slotCode,
    registeredCount,
    isClosed: false,
    closureReason: null,
    ...over,
  });
  const k = (slot: string) => enrollmentKey(2, 2, '一般游泳(6足歲以上)', slot);

  it('keeps the largest count per key instead of summing, in either order (R051)', () => {
    expect(indexEnrollment([item('A', 5), item('A', 8), item('B', 3)]).counts.get(k('A'))).toBe(8);
    expect(indexEnrollment([item('A', 8), item('A', 5)]).counts.get(k('A'))).toBe(8);
    expect(indexEnrollment([item('A', 5), item('B', 3)]).counts.get(k('B'))).toBe(3);
  });

  it('closes the whole key when any row is closed and keeps the last closed row reason (R051)', () => {
    const closedFirst = indexEnrollment([item('A', 0, { isClosed: true, closureReason: '人數不足' }), item('A', 4)]);
    expect(closedFirst.closures.get(k('A'))).toStrictEqual({ isClosed: true, reason: '人數不足' });
    const openFirst = indexEnrollment([item('A', 4), item('A', 0, { isClosed: true, closureReason: '場地維修' })]);
    expect(openFirst.closures.get(k('A'))).toStrictEqual({ isClosed: true, reason: '場地維修' });
    const twoClosed = indexEnrollment([item('A', 0, { isClosed: true, closureReason: '甲' }), item('A', 0, { isClosed: true, closureReason: '乙' })]);
    expect(twoClosed.closures.get(k('A'))?.reason).toBe('乙');
    expect(indexEnrollment([item('B', 1)]).closures.get(k('B'))).toStrictEqual({ isClosed: false, reason: null });
  });
});

describe('staffing rules per venue (R084)', () => {
  const venue = (name: string) => VENUES.find(v => v.name === name)!;

  it('front desk is fixed at 1-2, lifeguard follows the venue configuration (R084)', () => {
    expect(venueRule(venue('新北高中'), 'lifeguard')).toStrictEqual({ min: 2, max: 3, label: '救生' });
    expect(venueRule(venue('三重商工'), 'lifeguard')).toStrictEqual({ min: 1, max: 2, label: '救生' });
    expect(venueRule(venue('三民高中'), 'lifeguard')).toStrictEqual({ min: 1, max: 2, label: '救生' });
    VENUES.forEach(v => expect(venueRule(v, 'frontdesk')).toStrictEqual({ min: 1, max: 2, label: '櫃台' }));
  });
});

describe('issue grouping (R092)', () => {
  const issue = (type: Issue['type'], n: number): Issue => ({ venue: '新北高中', cells: `格${n}`, text: `訊息${n}`, type });

  it('orders groups critical, shortage, notice, drops empty groups and carries the badge hint (R092)', () => {
    const groups = groupIssues([issue('notice', 1), issue('shortage', 2), issue('critical', 3), issue('critical', 4)], 20);
    expect(groups.map(g => [g.type, g.label, g.hint, g.total, g.items.length])).toStrictEqual([
      ['critical', '嚴重錯誤', '必須優先處理', 2, 2],
      ['shortage', '排班不足', '需補人或確認', 1, 1],
      ['notice', '提醒', '可檢查後處理', 1, 1],
    ]);
    expect(groupIssues([issue('shortage', 1)], 20).map(g => g.type)).toStrictEqual(['shortage']);
    expect(groupIssues([], 20)).toStrictEqual([]);
  });

  it('lists at most the limit per group but still counts every issue (R092)', () => {
    const many = Array.from({ length: 25 }, (_, i) => issue('critical', i));
    const [g] = groupIssues(many, 20);
    expect(g.total).toBe(25);
    expect(g.items.map(i => i.cells)).toStrictEqual(many.slice(0, 20).map(i => i.cells));
  });
});

describe('save payload (R104)', () => {
  const generatedAt = new Date('2026-07-06T06:05:00.000Z');

  it('sends exactly version, weekNo, generatedAt, rawEntries, assignments and shifts (R104, S18)', () => {
    const p = pipelines.find(x => x.name === 'week2-full')!;
    const model = modelFrom(p.fx);
    const payload = buildSavePayload(model, model.draft, generatedAt);
    expect(Object.keys(payload)).toStrictEqual(['version', 'weekNo', 'generatedAt', 'rawEntries', 'assignments', 'shifts']);
    expect(payload).toMatchObject({ version: 'v40', weekNo: 2, generatedAt: '2026-07-06T06:05:00.000Z' });
    expect(payload.assignments).toStrictEqual(collectAssignments(model));
    expect(payload.shifts).toStrictEqual(collectShiftRows(collectAssignments(model), model.week));
    expect(payload.shifts.length).toBeGreaterThan(0);
  });

  it('collects rawEntries from the draft itself: cells first, then meta-only keys with an empty value (R104)', () => {
    const m = (id: number): EmployeeMeta => ({ employeeId: id, employeeName: '甲', lineBound: false, role: '', venueId: '', venueName: '' });
    const draft: Draft = { cells: new Map([['w1-a', '王偉']]), meta: new Map([['w1-b', [m(5)]]]) };
    const model = modelFrom(pipelines[0].fx);
    expect(buildSavePayload(model, draft, generatedAt).rawEntries).toStrictEqual([
      { key: 'w1-a', value: '王偉', employees: [] },
      { key: 'w1-b', value: '', employees: [m(5)] },
    ]);
  });
});

describe('stored draft round trip (cellKey compatibility with the server draft)', () => {
  it.each(pipelines.map(p => [p.name, p] as const))('%s: stored rawEntries hydrate and save back to the same entries in the same order (R104, R113)', (_n, p) => {
    const lastPerKey = new Map<string, { key: string; value: string; employees: unknown[] }>();
    p.fx.rawEntries.forEach(e => lastPerKey.set(String(e.key), { key: String(e.key), value: String(e.value ?? ''), employees: Array.isArray(e.employees) ? e.employees : [] }));
    expect(rawEntriesFromDraft(draftFromRawEntries(p.fx.rawEntries))).toStrictEqual([...lastPerKey.values()]);
  });
});

describe('manual course form defaults (R069)', () => {
  it('opens with 16:00-17:00, 4 enrolled, 1 coach needed and everything else empty (R069)', () => {
    expect(EMPTY_MANUAL_FORM).toStrictEqual({ dates: '', courseName: '', startTime: '16:00', endTime: '17:00', registeredCount: '4', requiredCoaches: '1', note: '' });
    const filled = { ...EMPTY_MANUAL_FORM, dates: '07/13', courseName: '補習班游泳' };
    const r = validateManualCourseForm(filled, '新北高中', weekByNo(2), new Date('2026-07-01T00:00:00Z'));
    expect(r.ok && r.items.map(i => [i.startTime, i.endTime, i.registeredCount, i.requiredCoaches])).toStrictEqual([['16:00', '17:00', 4, 1]]);
  });

  it('after a successful add only dates, name and note are cleared (R069)', () => {
    const used = { dates: '07/13、07/20', courseName: '補習班游泳', startTime: '18:00', endTime: '19:30', registeredCount: '9', requiredCoaches: '2', note: '包班' };
    expect(formAfterAdd(used)).toStrictEqual({ dates: '', courseName: '', startTime: '18:00', endTime: '19:30', registeredCount: '9', requiredCoaches: '2', note: '' });
  });
});

describe('cellKey grammar (R221, contract 4.2)', () => {
  it('every generator produces the exact key shape the server draft already stores (R221)', () => {
    expect(courseCellKey(2, '新北高中', courseRowId('一般游泳(6足歲以上)', 'A', 'weekday'), 'needed')).toBe('w2-新北高中-course-一般游泳_6足歲以上-A-needed');
    expect(courseCellKey(2, '新北高中', courseRowId('游泳假日班', 'B', 'holiday'), 'sat')).toBe('w2-新北高中-course-holiday-游泳假日班-B-sat');
    expect(overrideKey(courseCellKey(2, '新北高中', courseRowId('一般游泳(6足歲以上)', 'A', 'weekday'), 'enroll'))).toBe('w2-新北高中-course-一般游泳_6足歲以上-A-enroll:override');
    expect(manualCellKey(2, '新北高中', 15, 'coach')).toBe('w2-新北高中-manual-15-coach');
    expect(dutyGridCellKey(2, '新北高中', 'lifeguard', 1, 1)).toBe('w2-新北高中-lifeguard-dutygrid-r1-d1');
    expect(dutyGridRowsKey(2, '三重商工', 'frontdesk')).toBe('w2-三重商工-frontdesk-dutygrid-rows');
    expect(availabilityKey(1, 2, 'weekday')).toBe('w1-availability-2-weekday');
  });

  it('the manual coach key round-trips to its course id and other keys do not (R221, R070)', () => {
    expect(manualCourseIdFromCoachKey(manualCellKey(2, '新北高中', 15, 'coach'))).toBe('15');
    expect(manualCourseIdFromCoachKey(manualCellKey(2, '新北高中', 15, 'note'))).toBe('');
  });
});

describe('manual course messages (R072, R076)', () => {
  it('uses the exact alert and confirm wording the admin already knows (R072, R076)', () => {
    expect(MANUAL_COURSE_MESSAGES).toStrictEqual({
      createFailed: '手動課程新增失敗，資料沒有同步到伺服器。請確認登入狀態與網路後再試一次。',
      deleteConfirm: '刪除這筆手動課程？',
      deleteFailed: '手動課程刪除失敗，伺服器資料沒有變更。請確認登入狀態與網路後再試一次。',
      empty: '本週尚未新增手動課程。',
    });
  });
});
