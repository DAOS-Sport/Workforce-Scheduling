const { employees } = require('./scenarios.cjs');
const EDIT_CASES = require('./unit-cases-edits.cjs');

const roster = employees;
const aliasConfig = { nameAliases: { 莊子宏: '莊子鋐', 陳美玲跟課: '陳美', 王小明: '王偉' } };

const coachLines = [
  '王偉',
  '王偉 13',
  '王偉 14:00-15:00',
  '王偉 14:00-15:00 45',
  '*莊柏彥*劉承翰 123',
  '＊莊柏彥 135',
  'a莊子鋐1234',
  'Ａ莊子鋐 25',
  'Anna陳美',
  '王偉a李四',
  '侯凱捷跟課45',
  '跟課侯凱捷',
  '陳美王偉',
  '陳美玲',
  '陳美、王偉 24',
  '王偉+李四',
  '王偉（未綁定） 3',
  '莊子宏12',
  '王小明 1',
  '待排',
  '缺',
  'x',
  '',
  '王偉 8:00-9:00 15',
  '王偉 0800-0900 2',
  '王偉\n\n劉承翰 5\n待確認',
  '路人甲 123\n路人甲',
];

const UNIT_CASES = {
  ...EDIT_CASES,
  weeks: { call: '() => weeks.map((w, i) => ({ ...w, optionValue: String(i) }))', cases: [[]] },
  venues: { call: '() => venues', cases: [[]] },
  parseTimeRange: {
    call: 't => parseTimeRange(t)',
    cases: [['9:00～17:00'], ['17:00-9:00'], ['08:00 - 12:00'], ['8:00－9:30'], ['0800-1700'], ['王 10:00~10:00'], ['x 07:30-09:00 y'], ['24:00-25:00'], [''], ['09:00-17:00 13:00-14:00']],
  },
  parseLooseTimeRange: {
    call: 't => parseLooseTimeRange(t)',
    cases: [['王小明 櫃0800-1700'], ['800-1200'], ['王 0900到1100'], ['王 09:00至11:30'], ['王 1200-0800'], ['王 08001200'], ['王 8:00-9:00'], ['王']],
  },
  compactTimeLabel: { call: 't => compactTimeLabel(t)', cases: [['08:00-17:00'], ['5:30-8:00'], ['待定'], ['']] },
  timesOverlap: {
    call: '(a, b) => timesOverlap(a, b)',
    cases: [[{ start: 480, end: 600 }, { start: 600, end: 720 }], [{ start: 480, end: 601 }, { start: 600, end: 720 }], [null, { start: 1, end: 2 }], [{ start: 0, end: 1440 }, { start: 30, end: 40 }]],
  },
  normalizeName: { call: 's => normalizeName(s)', cases: [['王偉(代)123'], ['  王偉 ，李四 '], ['【臨時】王-偉'], ['a/b\\c'], ['']] },
  activeDaysForPeriod: {
    call: '(p, i) => activeDaysForPeriod(p, weeks[i])',
    cases: [['weekday', 0], ['weekday', 1], ['sat', 0], ['sun', 4], ['manual-day-3', 2], ['manual-day-9', 2], ['other', 1]],
  },
  dutyPeriodForDay: { call: 'd => dutyPeriodForDay(d)', cases: [[1], [5], [6], [7], [0], ['3']] },
  dayName: { call: 'd => dayName(d)', cases: [[1], [7], [8]] },
  datesInWeek: { call: 'i => datesInWeek(weeks[i])', cases: [[0], [1], [8]] },
  usefulLines: { call: 't => usefulLines(t)', cases: [['王偉\n待排\n缺'], [' 王偉（未綁定） \n\n\n－\n確認中\nX\n李四(LINE未綁定)'], ['']] },
  cleanEmployeeDisplayName: { call: 's => cleanEmployeeDisplayName(s)', cases: [['王偉(LINE未綁定) '], ['王偉（未綁定）（未綁定）'], ['(未綁定)王偉']] },
  roleMarkerFromLine: { call: 's => roleMarkerFromLine(s)', cases: [['王偉 救0800-1200'], ['王偉 櫃0800'], ['Floyd 0800-1200'], ['Front Desk 王'], ['life guard 王'], ['王 lg'], ['王偉 0800-1200']] },
  slug: { call: 's => slug(s)', cases: [['一般游泳(6足歲以上)'], ['棒球課(室內+室外)'], ['室內 羽球/課'], ['__a__']] },
  venueIdByName: { call: 's => venueIdByName(s)', cases: [['夢想-新北高中館'], ['三重商工分館'], ['三民高中'], ['不存在'], ['']] },
  boxText: {
    call: 'h => { const d = document.createElement("div"); d.innerHTML = h; return boxText(d); }',
    cases: [['<div>a</div><div>b</div>'], ['a<br>b<br/><br>c'], ['&nbsp;x&lt;y&gt;&amp;&quot;&#39;'], ['<p>p</p><li>l</li>'], [''], ['<br><br>a<br><br>']],
  },
  splitCoachLineParts: {
    employees: roster,
    pvConfig: aliasConfig,
    call: 'l => splitCoachLineParts(l)',
    cases: coachLines.map(l => [l]),
  },
  tokenizeCoachLine: { call: 'l => tokenizeCoachLine(l)', cases: coachLines.map(l => [l]) },
  splitCoachNames: {
    employees: [{ id: 1, name: '陳美' }, { id: 2, name: '王偉' }, { id: 3, name: '美王' }, { id: 4, name: '陳美王偉' }],
    call: 's => splitCoachNames(s)',
    cases: [['陳美王偉'], ['陳美玲'], ['陳美、王偉'], ['王偉陳美 李四'], ['美王偉'], [''], ['陳美王偉陳美']],
  },
  splitCoachNamesEmptyRoster: { employees: [], call: 's => splitCoachNames(s)', cases: [['陳美王偉'], ['陳美 王偉']] },
  coachRoleOf: { call: '(m, f) => coachRoleOf(m, f)', cases: [['*', false], ['＊', true], ['a', false], ['Ａ', true], ['', true], ['', false]] },
  parseAssignments: {
    employees: roster,
    pvConfig: aliasConfig,
    call: '(t, p, i) => parseAssignments(t, p, weeks[i], "")',
    cases: [
      ...coachLines.map(l => [l, 'weekday', 1]),
      ...coachLines.slice(0, 8).map(l => [l, 'weekday', 0]),
      ['王偉 13', 'sat', 1],
      ['王偉 13', 'manual-day-4', 1],
      ['王偉 12', 'sun', 0],
    ],
  },
  duplicateAndCounts: {
    employees: roster,
    call: '(t, p, i) => { const a = parseAssignments(t, p, weeks[i], ""); return { dups: duplicateNamesInAssignments(a), byDay: countAssignmentsByDay(t, p, weeks[i], ""), single: countAssignmentsSingle(t, p, weeks[i], ""), ids: a.map(assignmentIdentity) }; }',
    cases: [['王偉 12\n王偉 23', 'weekday', 1], ['路人 1\n路人 2', 'weekday', 1], ['王偉\n李四\n王偉', 'sat', 1], ['*王偉*王偉', 'weekday', 0], ['', 'manual-day-2', 1]],
  },
  parseDutyGridLines: {
    employees: roster,
    call: '(t, r, d, i) => parseDutyGridLines(t, r, d, weeks[i], null, "新北高中", "").map(x => ({ name: x.name, employeeId: x.employeeId, lineBound: x.lineBound, role: x.role, time: x.time, days: x.days, raw: x.raw, venueId: x.venueId, period: x.period, dayNo: x.dayNo }))',
    cases: [
      ['陳美 救0800-1200\n王偉 櫃0900-1000', 'lifeguard', 1, 1],
      ['陳美 救0800-1200\n王偉 櫃0900-1000', 'frontdesk', 1, 1],
      ['李四 fd 08:00-12:00 3', 'frontdesk', 3, 1],
      ['王偉', 'lifeguard', 1, 1],
      ['0800-1200', 'lifeguard', 1, 1],
      ['路人甲 救0900到1100', 'lifeguard', 6, 1],
      ['Floyd 0800-1200', 'lifeguard', 2, 1],
    ],
  },
  employeeNormalize: {
    call: 'e => normalizeEmployeeFromApi(e)',
    cases: [[{ id: 5, name: '王偉', venue: '新北高中' }], [{ id: '7', name: '陳', venueName: '三重商工', venue: 'x', venueId: 0, lineBound: 'yes', lineDisplayName: 'C', lineBoundAt: 't' }], [{ name: '無' }]],
  },
  lineBound: {
    call: 'e => ({ employee: isEmployeeLineBound(e), simple: isLineBound(e), display: employeeDisplayNameWithLineStatus(e) })',
    cases: [[{ name: '王偉', lineBound: false, lineDisplayName: 'Wei' }], [{ name: '王偉', lineBound: true }], [{ name: '王偉', lineBound: 'true' }], [{ name: '', lineBound: true }], [{ employeeName: '陳', lineUserId: 'u' }], [null]],
  },
  employeeLabel: { call: 'e => employeeLabel(e)', cases: [[{ name: '王偉', role: '教練', venueName: '新北高中', lineBound: false }], [{ name: '王偉', role: '', venue: '三民高中', lineBound: true }]] },
  unwrapApiPayload: { call: 'j => unwrapApiPayload(j)', cases: [[{ data: null }], [{ data: { a: 1 } }], [{ a: 1 }], [null], [[1]]] },
  extractApiItems: { call: 'j => extractApiItems(j)', cases: [[{ data: { rows: ['a'] } }], [[1, 2]], [{ items: [1], employees: [2] }], [{ employees: [2] }], [{ data: [3] }], [{ data: { data: [4] } }], [{}], [null]] },
  extractApiMeta: {
    call: 'j => extractApiMeta(j)',
    cases: [[{}], [{ data: { lastUpdated: 'x', filters: { weekNo: 2 } } }], [{ lastUpdated: 'y', source: 'cache', data: { debug: 1 } }]],
  },
  normalizeCourseNameForEnrollment: {
    call: 'n => normalizeCourseNameForEnrollment(n)',
    cases: [['一般游泳(6足歲以上)'], ['幼幼班游泳'], ['玩水班'], ['室內羽球課'], ['室外籃球課'], ['室內桌球課'], ['棒球課(室內+室外)'], ['高階游泳班'], ['游泳假日班'], [' 一般 泳泳 '], [''], ['補習班（游泳）']],
  },
  enrollmentLookupKeysForRow: {
    call: '(w, v, n, s, k) => enrollmentLookupKeysForRow(w, v, n, s, k)',
    cases: [[3, '2', '游泳假日班', 'a', 'holiday'], [3, '2', '游泳假日班', 'a', 'weekday'], [2, 1, '一般游泳(6足歲以上)', ' b ', 'weekday'], [0, '', '', '', '']],
  },
  normalizeEnrollmentItemFromApi: {
    call: '(r, w) => normalizeEnrollmentItemFromApi(r, w)',
    cases: [[{ weekNo: '2', venueId: 2, courseName: 'x', slotCode: ' a ', registeredCount: '5', isClosed: 'true' }, 0], [{ venueId: ' 3 ', registeredCount: null, isClosed: true, closureReason: '颱風' }, 4]],
  },
  parseManualDates: {
    call: '(s, y) => parseManualDates(s, y)',
    cases: [
      ['07/06、07/13、07/20', 2026],
      ['2026/7/6, 7-8；07.10', 2026],
      ['06/30', 2026],
      ['07/09~07/06', 2026],
      ['07/05 ~ 07/07', 2026],
      ['07/06~07/09', 2026],
      ['07/01~07/02', 2026],
      ['08/29～09/02', 2026],
      ['07/06 07/06 abc 7/32', 2026],
      ['', 2026],
    ],
  },
  manualDateHelpers: {
    call: 'd => ({ week: weekNoForDate(d), day: dayOfWeekForDate(d), label: formatManualDate(d) })',
    cases: [['2026-07-06'], ['2026-07-05'], ['2026-08-30'], ['2026-08-31'], ['2026-06-30'], ['bad']],
  },
  normalizeManualCourseRow: {
    call: '(r, w) => normalizeManualCourseRow(r, w)',
    cases: [[{ id: 15, date: '2026-07-06', venue: '新北高中', courseName: '補習班游泳', registeredCount: '3', requiredCoaches: 'x', employeeId: 9, employeeName: '王偉', createdAt: 't' }, 2], [{ id: 'local-1', weekNo: '4' }, 2]],
  },
  isoDateForWeekDay: { call: '(i, d) => isoDateForWeekDay(weeks[i], d)', cases: [[0, 1], [0, 5], [0, 7], [1, 1], [1, 7], [8, 3], [1, 0], [1, 8]] },
  notesForShift: {
    call: 'a => notesForShift(a)',
    cases: [
      [{ roleType: 'course', source: 'registration', courseName: '一般游泳(6足歲以上)', slotCode: 'A', registeredCount: '12', requiredCoaches: '2', manualCourseId: '' }],
      [{ roleType: 'course', source: 'manual', courseName: '補習班游泳', slotCode: 'MANUAL', registeredCount: '', requiredCoaches: '1', manualCourseId: '15' }],
      [{ roleType: 'lifeguard', courseName: '', slotCode: '' }],
      [{ roleType: 'frontdesk', courseName: '', slotCode: '' }],
    ],
  },
  minutesToTime: { call: 'm => minutesToTime(m)', cases: [[450], [0], [1350], [65]] },
  classifyIssue: {
    call: 't => ({ type: classifyIssue(t), label: issueGroupLabel(classifyIssue(t)), hint: issueGroupHint(classifyIssue(t)) })',
    cases: [['人員重複：王'], ['五不足0/1'], ['有 1 筆未讀到時間'], ['撞班：王 同時排到「x」'], ['教練超過：3/2'], ['請先填需教練數'], ['不在可排班時段：王 週一 08:00-09:00']],
  },
  issueGroupFallback: { call: 't => [issueGroupLabel(t), issueGroupHint(t)]', cases: [['x']] },
  formatUpdatedTime: { call: 's => formatUpdatedTime(s)', cases: [['2026-07-06T06:05:00Z'], ['2026-07-31T16:30:00Z'], [''], [null]] },
  rawEntryHasScheduleValue: {
    call: 'e => rawEntryHasScheduleValue(e)',
    cases: [
      [{ key: 'w1-新北高中-course-X-A-enroll', value: '12' }],
      [{ key: 'w1-新北高中-course-X-A-needed', value: '2' }],
      [{ key: 'w1-availability-1-name', value: '王' }],
      [{ key: 'w1-新北高中-lifeguard-dutygrid-rows', value: '4' }],
      [{ key: 'w1-x', value: '  ', employees: [] }],
      [{ key: 'w1-x', value: '', employees: [{ employeeId: 1 }] }],
      [{ key: 'w1-新北高中-course-X-A-enroll:override', value: '1' }],
    ],
  },
  payloadRows: {
    call: 'p => ({ shift: payloadHasShiftRows(p), work: payloadHasWorkRows(p), value: payloadHasScheduleValue(p) })',
    cases: [[{ shifts: [], shiftEntries: [1] }], [{ assignments: [1] }], [{ rawEntries: [{ key: 'w1-a', value: '王' }] }], [{}]],
  },
  findEmployeeForLine: {
    employees: roster,
    call: '(name, key, meta) => { scheduleState.meta.delete(key); if (meta) scheduleState.meta.set(key, meta); const e = findEmployeeForLine(name, key); return e ? { id: e.id, name: e.name, role: e.role, lineBound: !!e.lineBound } : null; }',
    cases: [
      ['舊名字', 'w2-meta-a', [{ employeeId: 9, employeeName: '舊名字' }]],
      ['9', 'w2-meta-a', [{ employeeId: 9, employeeName: '舊名字' }]],
      ['外聘', 'w2-meta-b', [{ employeeId: 99, employeeName: '外聘', role: '教練', lineBound: true }]],
      ['陳美', 'w2-meta-c', [{ employeeId: 99, employeeName: '外聘' }]],
      ['陳', 'w2-meta-c', [{ employeeId: 99, employeeName: '外聘' }]],
      ['王偉', 'w2-meta-d', null],
      ['王偉', 'w2-meta-d', []],
      ['沒人', 'w2-meta-d', null],
    ],
  },
};

module.exports = { UNIT_CASES };
