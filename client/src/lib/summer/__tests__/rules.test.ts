import { describe, expect, it } from 'vitest';
import { availabilityIntervals, availabilityReport, availabilityRowsFromApi, type AvailabilityRow } from '../availability';
import { WEEKS, weekByNo, weekOptions } from '../config';
import { weekPrefix } from '../cell-key';
import { hasFollowMark, stripFollowMark } from '../parse';
import { workEntries } from '../validate';
import { addDays, dayNoOf, hourMinute, isIsoDate } from '../dates';
import { enrollmentStatusText, externalCourses, EXTERNAL_EMPTY_TEXT, normalizeEnrollmentItems } from '../enrollment';
import { dedupeManualCourses, manualCoachSelection, manualCourseSignature, normalizeManualCourse, otherWeeksNotice, applyManualField, validateManualCourseForm, canPatchManualCourse } from '../manual-course';
import { blocksEmptySave, collectAssignments, draftFromRawEntries } from '../payload';
import {
  checklistProgress,
  coachOptionNames,
  EMPTY_PAYROLL_CONFIG,
  hourlyRates,
  multiplier,
  parsePayrollConfig,
  rateFor,
  roleBadge,
  typeBadgeClass,
  withCoachRate,
  withMultipliers,
  addCourseType,
  removeCourseType,
  withNameAlias,
  withTypeOverride,
  parseCramSchools,
  type PayrollConfig,
  type StaffStats,
} from '../payroll';
import { createRoster, findEmployeeForLine, normalizeEmployee } from '../roster';
import { rulerTicks, stageVenue, stageView, axisPct, fmtHours } from '../stage';
import type { Employee, EnrollmentItem, IsoDate, ManualCourse } from '../types';
import type { WorkEntry } from '../validate';
import { buildWeekModel } from '../week-model';

const week2 = weekByNo(2);
const emp = (raw: Record<string, unknown>) => normalizeEmployee(raw) as Employee;
const cfg = (over: Partial<PayrollConfig>): PayrollConfig => ({ ...EMPTY_PAYROLL_CONFIG, ...over });

describe('enrollment state (R059, R060, R062)', () => {
  const items: EnrollmentItem[] = normalizeEnrollmentItems(
    [
      { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'A', registeredCount: 12 },
      { weekNo: 2, venueId: 2, courseName: '幼幼班游泳', slotCode: 'A1', registeredCount: 0, isClosed: true },
      { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'B', registeredCount: 8 },
      { weekNo: 3, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'A', registeredCount: 5 },
    ],
    2,
  );

  it('status badge text for loaded, loading and failed responses (R059)', () => {
    expect(enrollmentStatusText({ kind: 'loaded', weekNo: 2, items, lastUpdated: '2026-07-06T06:05:00Z' })).toBe('報名人數：API即時帶入｜更新 07/06 下午02:05');
    expect(enrollmentStatusText({ kind: 'loaded', weekNo: 2, items, lastUpdated: null })).toBe('報名人數：API即時帶入');
    expect(enrollmentStatusText({ kind: 'failed', message: '請先登入管理後台' })).toBe('請先登入管理後台');
  });

  it('external read-only table filters by week and venue, sorts and totals without closed slots (R060)', () => {
    const r = externalCourses(items, 2, 2);
    expect(r.kind === 'rows' && r.rows.map(x => `${x.courseName}${x.slotCode}`)).toStrictEqual(['一般游泳(6足歲以上)A', '一般游泳(6足歲以上)B', '幼幼班游泳A1']);
    expect(r.kind === 'rows' && r.total).toBe(20);
    expect(externalCourses(items, 2, 1)).toStrictEqual({ kind: 'none-for-venue' });
    expect(externalCourses(null, 2, 2)).toStrictEqual({ kind: 'not-loaded' });
    expect(EXTERNAL_EMPTY_TEXT['none-for-venue']).toBe('本週此館別無外部報名課程。');
  });

  it('與 v40 不同：別週晚到的報名回應不會套到目前週（R062）', () => {
    const draft = draftFromRawEntries([{ key: 'w3-新北高中-course-一般游泳_6足歲以上-A-needed', value: '2' }]);
    const base = { week: weekByNo(3), draft, employees: [], aliases: {}, manualCourses: [] };
    const stale = buildWeekModel({ ...base, enrollment: { kind: 'loaded', weekNo: 2, items, lastUpdated: null } });
    const row = stale.venues[0].courseRows[0];
    expect(row.enrollText).toBe('...');
    expect(row.neededText).toBe('2');
    expect(stale.derivedCells.size).toBe(0);
    const fresh = buildWeekModel({ ...base, enrollment: { kind: 'loaded', weekNo: 3, items: normalizeEnrollmentItems([{ weekNo: 3, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'A', registeredCount: 5 }], 3), lastUpdated: null } });
    expect(fresh.venues[0].courseRows[0].enrollText).toBe('5');
  });
});

describe('manual courses (R068, R071-R075, R077, R078)', () => {
  const form = { dates: '07/13、07/20', courseName: ' 補習班游泳 ', startTime: '16:00', endTime: '17:00', registeredCount: '4', requiredCoaches: '1', note: ' 包班 ' };
  const now = new Date('2026-07-01T00:00:00Z');

  it('validates the form in order and builds one item per date (R071)', () => {
    const week1 = weekByNo(1);
    expect(validateManualCourseForm({ ...form, dates: '' }, '新北高中', week1, now)).toStrictEqual({ ok: false, message: '請輸入日期，例如 07/06、07/13、07/20' });
    expect(validateManualCourseForm({ ...form, courseName: ' ' }, '新北高中', week1, now)).toStrictEqual({ ok: false, message: '請輸入課程名稱' });
    expect(validateManualCourseForm({ ...form, endTime: '' }, '新北高中', week1, now)).toStrictEqual({ ok: false, message: '請輸入開始與結束時間' });
    expect(validateManualCourseForm({ ...form, startTime: '17:00', endTime: '16:00' }, '新北高中', week1, now)).toStrictEqual({
      ok: false,
      message: '結束時間（16:00）必須晚於開始時間（17:00），請重新確認',
    });
    const ok = validateManualCourseForm(form, '三重商工', week1, now);
    expect(ok.ok && ok.items.map(i => [i.date, i.weekNo, i.venueId, i.courseName, i.note, i.registeredCount])).toStrictEqual([
      ['2026-07-13', 3, 1, '補習班游泳', '包班', 4],
      ['2026-07-20', 4, 1, '補習班游泳', '包班', 4],
    ]);
  });

  it('tells the user when every created course lands in another week (R072)', () => {
    expect(otherWeeksNotice([{ weekNo: 3 }, { weekNo: 4 }], 1)).toBe('已新增 2 筆手動課程，分別排在第3、第4週（目前檢視第 1 週）。請切換週次即可看到。');
    expect(otherWeeksNotice([{ weekNo: 1 }, { weekNo: 3 }], 1)).toBeNull();
  });

  const course = normalizeManualCourse({ id: 15, date: '2026-07-06', weekNo: 2, venueId: 2, venueName: '新北高中', courseName: '補習班游泳', startTime: '16:00', endTime: '17:00', registeredCount: 4, requiredCoaches: 1 }, 2);

  it('parses edited numbers with parseInt and trims text (R073)', () => {
    expect(applyManualField(course, 'registeredCount', '3人').registeredCount).toBe(3);
    expect(applyManualField(course, 'requiredCoaches', 'abc').requiredCoaches).toBe(0);
    expect(applyManualField(course, 'note', '  備註 ').note).toBe('備註');
  });

  it('only numeric ids are patched and coach sync records the last picked employee (R074, R075)', () => {
    expect(canPatchManualCourse('local-1712')).toBe(false);
    expect(canPatchManualCourse(15)).toBe(true);
    const wang = emp({ id: 9, name: '王偉' });
    const patched = manualCoachSelection(course, 'w2-新北高中-manual-15-coach', wang);
    expect(patched).toMatchObject({ id: 15, employeeId: 9, employeeName: '王偉' });
    expect(manualCoachSelection(patched!, 'w2-新北高中-manual-15-coach', wang)).toBeNull();
    expect(manualCoachSelection(course, 'w2-新北高中-manual-15-note', wang)).toBeNull();
  });

  it('signature ignores the coach fields and dedupe keeps the first id|date|name (R077, R078)', () => {
    const withCoach: ManualCourse = { ...course, employeeId: 9, employeeName: '王偉' };
    expect(manualCourseSignature([withCoach], 2)).toBe(manualCourseSignature([course], 2));
    expect(manualCourseSignature([{ ...course, note: 'x' }], 2)).not.toBe(manualCourseSignature([course], 2));
    expect(dedupeManualCourses([course, { ...course, note: 'later' }]).map(c => c.note)).toStrictEqual(['']);
  });
});

describe('availability (R129, R131, R134)', () => {
  const roster = createRoster([emp({ id: 9, name: '王偉', lineBound: true })]);

  it('與 v40 不同：本週沒有填報時清空列表，不留上一週的列（R129）', () => {
    expect(availabilityRowsFromApi([], roster)).toStrictEqual([]);
    expect(availabilityRowsFromApi(null, roster)).toStrictEqual([]);
  });

  it('與 v40 不同：多段平日時段一律分行解析，不受頁籤隱藏影響（R131）', () => {
    const row: AvailabilityRow = { employeeId: 9, name: '王偉', venues: '全部', weekday: '07:30-12:00 1\n14:00-18:00 1', sat: '', sun: '', note: '', notSubmitted: false, lineBound: true };
    expect(availabilityIntervals([row], week2).map(i => [i.day, i.time.label])).toStrictEqual([
      [1, '07:30-12:00'],
      [1, '14:00-18:00'],
    ]);
  });

  it('與 v40 不同：救生與櫃台的已排工作 chip 時間只出現一次（R134）', () => {
    const row: AvailabilityRow = { employeeId: 9, name: '王偉', venues: '全部', weekday: '05:00-15:00 1', sat: '', sun: '', note: '', notSubmitted: false, lineBound: true };
    const work: WorkEntry = { roleType: 'lifeguard', cellKey: 'k' as never, rowKey: 'r', venue: '新北高中', name: '王偉', employeeId: 9, days: [1], time: { start: 330, end: 840, label: '05:30-14:00' }, courseName: '', slotCode: '' };
    const [report] = availabilityReport(availabilityIntervals([row], week2), [work]);
    expect(report.busy).toStrictEqual([{ kind: 'lifeguard-busy', text: '救生｜新北高中 05:30-14:00' }]);
    expect(report.open).toStrictEqual(['05:00-05:30', '14:00-15:00']);
  });
});

describe('payroll configuration (R138, R139, R146, R147, R164, R167, R168, R239, R241)', () => {
  it('coach edits derive lead and assist with Math.round, follow is untouched (R138)', () => {
    const c = withCoachRate(cfg({ mult: { 當班下: '0.3', 助教: '0.4' }, rates: { '球類課程|跟課': '50' } }), '球類課程', '455');
    expect([c.rates['球類課程|當班下'], c.rates['球類課程|助教'], c.rates['球類課程|跟課']]).toStrictEqual(['137', '182', '50']);
    const m = withMultipliers(cfg({ rates: { '游泳一般團班|教練': '600' } }), 0.3, 0.4);
    expect([m.rates['游泳一般團班|當班下'], m.rates['游泳一般團班|助教']]).toStrictEqual(['180', '240']);
  });

  it('multiplier falls back to 0.3 / 0.4 when unset (R139)', () => {
    expect([multiplier(EMPTY_PAYROLL_CONFIG, '當班下'), multiplier(EMPTY_PAYROLL_CONFIG, '助教')]).toStrictEqual([0.3, 0.4]);
    expect(multiplier(cfg({ mult: { 當班下: '0' } }), '當班下')).toBe(0);
  });

  it('與 v40 不同：費率只讀後端設定，本機舊值不再蓋回（R168）', () => {
    const c = cfg({ rates: { '球類課程|教練': '400', '球類課程|當班下': '' } });
    expect(rateFor(c, '球類課程', '教練')).toBe(400);
    expect(rateFor(c, '球類課程', '當班下')).toBe(0);
    expect(rateFor(c, '球類課程', '不認識的角色')).toBe(400);
    expect(rateFor(c, '不存在的類型', '教練')).toBe(0);
  });

  it('hourly rates come from the shared config before the salary-rates API (R167, S09)', () => {
    const backend = [{ role: 'lifeguard', ratePerHour: 190 }, { label: '櫃台', amount: '180' }];
    expect(hourlyRates(EMPTY_PAYROLL_CONFIG, backend)).toStrictEqual({ lifeguard: 190, frontdesk: 180 });
    expect(hourlyRates(cfg({ hourly: { lifeguard: '200' } }), backend)).toStrictEqual({ lifeguard: 200, frontdesk: 180 });
  });

  it('parses the stored config value and keeps an unset value distinct (R239)', () => {
    const loaded = parsePayrollConfig({ data: { value: '{"hours":{"球類課程":"2"}}' } });
    expect(loaded.kind === 'loaded' && [loaded.config.hours, loaded.config.types, loaded.config.rates]).toStrictEqual([{ 球類課程: '2' }, null, {}]);
    expect(parsePayrollConfig({ data: { value: null } })).toStrictEqual({ kind: 'unset' });
    expect(parsePayrollConfig({ data: { value: '{bad' } })).toStrictEqual({ kind: 'invalid' });
  });

  it('type and alias edits (R144, R154, R156, V068, V069)', () => {
    expect(addCourseType(EMPTY_PAYROLL_CONFIG, '球類課程')).toStrictEqual({ kind: 'rejected', message: '已經有這個課程類型了。' });
    const added = addCourseType(EMPTY_PAYROLL_CONFIG, '體適能');
    expect(added.kind === 'changed' && [added.config.types?.at(-1), added.config.hours['體適能']]).toStrictEqual(['體適能', '1']);
    const withOv = withTypeOverride(added.kind === 'changed' ? added.config : EMPTY_PAYROLL_CONFIG, '夏令營', '體適能');
    const removed = removeCourseType(withOv, '體適能');
    expect(removed.kind === 'changed' && [removed.config.types?.includes('體適能'), removed.config.typeOverrides]).toStrictEqual([false, {}]);
    expect(removeCourseType(EMPTY_PAYROLL_CONFIG, '球類課程')).toStrictEqual({ kind: 'rejected', message: '內建類型不可刪除。若不想用，把費率留 0 即可。' });
    expect(withNameAlias(withNameAlias(EMPTY_PAYROLL_CONFIG, ' 王偉跟課 ', '王偉'), '王偉跟課', '').nameAliases).toStrictEqual({});
  });

  it('badge classes for roles and course types (R146, R147)', () => {
    expect(['', '跟課', '當班下', '助教'].map(r => roleBadge(r))).toStrictEqual([
      { text: '教練', className: 'coach' },
      { text: '跟課', className: 'follow' },
      { text: '當班下', className: 'lead' },
      { text: '助教', className: 'assist' },
    ]);
    expect(['球類課程', '體適能', '幼兒游泳班'].map(typeBadgeClass)).toStrictEqual(['ball', 'cram', 'kid']);
  });

  it('checklist progress over six items (R164)', () => {
    expect(checklistProgress(new Set(['rates', 'venue']))).toStrictEqual({ done: 2, total: 6, pct: (2 / 6) * 100, text: '2 / 6' });
  });

  it('coach filter suggestions are sorted by name (R241)', () => {
    const names = ['王偉', '陳美', '李四'].map(n => ({ employeeName: n }) as StaffStats);
    expect(coachOptionNames(names)).toStrictEqual(['王偉', '陳美', '李四'].sort((a, b) => a.localeCompare(b, 'zh-Hant')));
  });
});

describe('stage axis and dispatch (R170-R172, R193)', () => {
  it('axis maps 05:30-22:30 to 0-100% (R170, R171)', () => {
    expect(axisPct(480)).toBeCloseTo(14.706, 3);
    expect(fmtHours(330, 840)).toBe('8.5h');
    expect(fmtHours(480, 600)).toBe('2h');
  });

  it('ruler ticks at 05:30 then every two hours with a noon gridline (R172)', () => {
    const ticks = rulerTicks();
    expect(ticks.map(t => t.label)).toStrictEqual(['05:30', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00']);
    expect(ticks.filter(t => t.noon).map(t => t.label)).toStrictEqual(['12:00']);
    expect(ticks.at(-1)!.pct).toBeCloseTo(97.06, 2);
  });

  it('unknown views fall back to the timeline and unknown venues to 新北高中 (R193)', () => {
    expect([stageView('excel'), stageView('matrix'), stageView('courses')]).toStrictEqual(['timeline', 'matrix', 'courses']);
    expect([stageVenue('all').name, stageVenue('三民高中').name]).toStrictEqual(['新北高中', '三民高中']);
  });
});

describe('save guard and time labels (R003, R097, R113)', () => {
  it('blocks a save that would blank out data the server already has (R097)', () => {
    const server = { rawEntries: [{ key: 'w1-x', value: '王偉', employees: [] }], shiftEntries: [{}] };
    expect(blocksEmptySave(server, { rawEntries: [], assignments: [], shifts: [] })).toBe(true);
    expect(blocksEmptySave(server, { rawEntries: [{ key: 'w1-x', value: '王偉', employees: [] }], assignments: [{}], shifts: [{}] })).toBe(false);
    expect(blocksEmptySave({}, { rawEntries: [] })).toBe(false);
  });

  it('hydrating a stored draft keeps the last value per key and the meta arrays (R113)', () => {
    const d = draftFromRawEntries([
      { key: 'a', value: '1' },
      { key: 'a', value: '2', employees: [] },
      { key: '', value: 'x' },
      { key: 'b', value: null, employees: 'bad' },
    ]);
    expect([...d.cells]).toStrictEqual([
      ['a', '2'],
      ['b', ''],
    ]);
    expect([...d.meta]).toStrictEqual([['a', []]]);
  });

  it('formats HH:MM in Taipei time (R003)', () => {
    expect(hourMinute(new Date('2026-07-06T06:05:00Z'))).toBe('14:05');
    expect(hourMinute(new Date('2026-07-06T16:00:00Z'))).toBe('00:00');
  });
});

describe('week table (R001)', () => {
  it('week 1 is Wed-Sun with active weekdays 3-5 and the rest are Mon-Sun', () => {
    expect(WEEKS[0]).toMatchObject({ start: '2026-07-01' as IsoDate, end: '2026-07-05' as IsoDate, activeWeekdays: [3, 4, 5] });
    expect(WEEKS.slice(1).every(w => w.activeWeekdays.join() === '1,2,3,4,5')).toBe(true);
  });
});

describe('keys, lookups and dates', () => {
  it('week number is the option index plus one and keys start with w{n}- (R002)', () => {
    expect(weekOptions()[1]).toStrictEqual({ value: '1', label: weekByNo(2).label });
    expect(weekPrefix(2)).toBe('w2-');
  });

  it('a line resolves through the cell meta by name or id before the roster (R023)', () => {
    const roster = createRoster([emp({ id: 9, name: '王偉', role: '教練' })]);
    const meta = new Map([['k', [{ employeeId: 99, employeeName: '臨時王', lineBound: false, role: '代課', venueId: '', venueName: '' }, { employeeId: 9, employeeName: '別名', lineBound: false, role: '', venueId: '', venueName: '' }]]]);
    expect(findEmployeeForLine({ roster, meta }, '臨時王', 'k')).toStrictEqual({ id: 99, name: '臨時王', role: '代課', lineBound: false });
    expect(findEmployeeForLine({ roster, meta }, '別名', 'k')?.name).toBe('王偉');
    expect(findEmployeeForLine({ roster, meta }, '王偉', 'other')?.id).toBe(9);
    expect(findEmployeeForLine({ roster, meta }, '路人', 'k')).toBeUndefined();
  });

  it('while enrollment loads, plain rows show ... and overrides keep their value with no derived writes (R058)', () => {
    const draft = draftFromRawEntries([
      { key: 'w2-新北高中-course-一般游泳_6足歲以上-B-enroll', value: '7' },
      { key: 'w2-新北高中-course-一般游泳_6足歲以上-B-enroll:override', value: '1' },
    ]);
    const m = buildWeekModel({ week: week2, draft, employees: [], aliases: {}, manualCourses: [], enrollment: { kind: 'loading' } });
    const [a, b] = m.venues[0].courseRows;
    expect([a.enrollText, b.enrollText]).toStrictEqual(['...', '7']);
    expect(m.derivedCells.size).toBe(0);
  });

  it('missing cells read as empty text (R222)', () => {
    const m = buildWeekModel({ week: week2, draft: draftFromRawEntries([]), employees: [], aliases: {}, manualCourses: [], enrollment: { kind: 'loading' } });
    expect(m.venues[0].courseRows[0].coachCells[0].text).toBe('');
    expect(m.venues[0].dutyCells.lifeguard.every(c => c.text === '')).toBe(true);
  });

  it('a manual course whose end is not after its start is left out of assignments and conflicts (R087)', () => {
    const bad = normalizeManualCourse({ id: 30, date: '2026-07-06', weekNo: 2, venueName: '新北高中', courseName: '倒過來', startTime: '17:00', endTime: '16:00' }, 2);
    const draft = draftFromRawEntries([{ key: 'w2-新北高中-manual-30-coach', value: '王偉' }]);
    const m = buildWeekModel({ week: week2, draft, employees: [emp({ id: 9, name: '王偉' })], aliases: {}, manualCourses: [bad], enrollment: { kind: 'loading' } });
    expect(m.venues[0].courseRows.find(r => r.rowId === 'manual-30')?.time).toBeNull();
    expect(collectAssignments(m)).toStrictEqual([]);
    expect(workEntries(m)).toStrictEqual([]);
  });

  it('follow marks are stripped from names and detected (R223)', () => {
    expect([stripFollowMark('侯凱捷跟課45'), hasFollowMark('侯凱捷跟課45'), hasFollowMark('侯凱捷')]).toStrictEqual(['侯凱捷45', true, false]);
  });

  it('ISO dates are parsed as calendar days independent of the machine time zone (R230)', () => {
    expect([isIsoDate('2026-07-06'), isIsoDate('2026-07-32'), isIsoDate('2026-7-6')]).toStrictEqual([true, false, false]);
    expect(addDays('2026-07-31' as IsoDate, 1)).toBe('2026-08-01');
    expect(dayNoOf('2026-07-05' as IsoDate)).toBe(7);
  });

  it('cram school input splits on spaces and punctuation (R144)', () => {
    expect(parseCramSchools('樂獅 新學林，立得、 ')).toStrictEqual(['樂獅', '新學林', '立得']);
  });
});
