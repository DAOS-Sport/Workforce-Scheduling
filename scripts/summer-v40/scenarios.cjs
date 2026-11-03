const employees = [
  { id: 9, name: '王偉', role: '教練', venueName: '新北高中', lineBound: true, lineDisplayName: 'Wei' },
  { id: 5, name: '陳美', role: '救生', venue: '三重商工', lineBound: false, lineDisplayName: 'Mei' },
  { id: 12, name: '莊子鋐', role: '教練', lineBound: false },
  { id: 13, name: '劉承翰', role: '教練', lineBound: true },
  { id: 14, name: '莊柏彥', role: '教練', lineBound: true },
  { id: 15, name: '侯凱捷', role: '教練', lineBound: 'true' },
  { id: 16, name: '李四', role: '櫃台', lineBound: true },
  { name: '沒有編號' },
];

const k = (w, rest) => `w${w}-${rest}`;
const e = (key, value, employeesMeta = []) => ({ key, value, employees: employeesMeta });

const week2Entries = [
  e(k(2, '新北高中-course-一般游泳_6足歲以上-A-weekday'), '王偉 13\n*莊柏彥*劉承翰 123'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-A-needed'), '2'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-B-weekday'), 'a莊子宏1234'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-B-needed'), '1'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-B-note'), '本週照排'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-C-weekday'), '陳美玲'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-C-needed'), '1'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-D-weekday'), '王偉 13\n王偉 23'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-D-needed'), '1'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-E-enroll'), '10'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-E-enroll:override'), '1'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-E-needed'), '0'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-E-weekday'), ' 侯凱捷 \n\n待排\n'),
  e(k(2, '新北高中-course-幼幼班游泳-A1-weekday'), '侯凱捷跟課45\n王偉 14:00-15:00'),
  e(k(2, '新北高中-course-幼幼班游泳-A1-needed'), '3'),
  e(k(2, '新北高中-course-室內羽球課-A-weekday'), '劉承翰'),
  e(k(2, '新北高中-course-室內羽球課-A-needed'), '1'),
  e(k(2, '新北高中-course-室內羽球課-A-enroll:override'), '1'),
  e(k(2, '新北高中-course-室內羽球課-A-enroll'), '4'),
  e(k(2, '新北高中-course-holiday-游泳假日班-A-sat'), '李四'),
  e(k(2, '新北高中-course-holiday-游泳假日班-A-sun'), '李四\n王偉（未綁定）'),
  e(k(2, '新北高中-course-holiday-游泳假日班-A-needed'), '1'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-F-weekday'), '臨時王'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-F-needed'), '1'),
  e(k(2, '新北高中-course-一般游泳_6足歲以上-F-weekday'), '臨時王', [{ employeeId: 99, employeeName: '臨時王', lineBound: false, role: '', venueId: '', venueName: '' }]),
  e(k(2, '新北高中-lifeguard-dutygrid-rows'), '4'),
  e(k(2, '新北高中-lifeguard-dutygrid-r1-d1'), '王偉 05:30-14:00'),
  e(k(2, '新北高中-lifeguard-dutygrid-r2-d1'), '陳美 救0600-2230'),
  e(k(2, '新北高中-lifeguard-dutygrid-r4-d3'), '劉承翰 救1000-1200\n莊柏彥 10:00'),
  e(k(2, '新北高中-frontdesk-dutygrid-r1-d1'), '李四 櫃0800-1200'),
  e(k(2, '新北高中-frontdesk-dutygrid-r1-d2'), '李四 櫃0800-1200'),
  e(k(2, '三重商工-lifeguard-dutygrid-r1-d1'), '陳美 救0800-1200\n王偉 櫃0900-1000'),
  e(k(2, '三重商工-frontdesk-dutygrid-r1-d2'), '李四 櫃0800-1700'),
  e(k(2, '三重商工-frontdesk-dutygrid-r5-d2'), '李四 櫃0800-1700'),
  e(k(2, '三民高中-lifeguard-dutygrid-r1-d6'), '王偉 08:00-12:00\n路人甲 救0900到1100'),
  e(k(2, '新北高中-manual-15-coach'), '王偉'),
  e(k(2, '三重商工-manual-16-coach'), '李四\n劉承翰'),
  e(k(2, 'availability-1-name'), '舊資料'),
  e(k(3, '新北高中-course-一般游泳_6足歲以上-A-weekday'), '別週資料'),
];

const week2Enrollment = {
  status: 200,
  lastUpdated: '2026-07-06T06:05:00Z',
  items: [
    { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'A', registeredCount: 12 },
    { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'B', registeredCount: 0 },
    { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'C', registeredCount: 5 },
    { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'D', registeredCount: 3 },
    { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'D', registeredCount: 8 },
    { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'E', registeredCount: 7 },
    { weekNo: 2, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'F', registeredCount: 9 },
    { weekNo: 2, venueId: 2, courseName: '幼幼班游泳', slotCode: 'a1', registeredCount: 6 },
    { weekNo: 2, venueId: 2, courseName: '室內羽球課', slotCode: 'A', registeredCount: 9, isClosed: true, closureReason: '人數不足' },
    { weekNo: 2, venueId: 2, courseName: '游泳假日班', slotCode: 'A', registeredCount: 8 },
    { weekNo: 2, venueId: '1', courseName: '一般游泳(6足歲以上)', slotCode: 'A', registeredCount: 4, isClosed: false },
    { weekNo: 2, venueId: 3, courseName: '', slotCode: 'A', registeredCount: 3 },
  ],
};

const week2Manual = [
  { id: 15, date: '2026-07-07', weekNo: 2, venueId: 2, venueName: '新北高中', courseName: '補習班游泳', startTime: '16:00', endTime: '17:00', registeredCount: 4, requiredCoaches: 1, note: '' },
  { id: 16, date: '2026-07-11', weekNo: 2, venueId: 1, venueName: '三重商工', courseName: '樂獅桌球', startTime: '09:00', endTime: '10:00', registeredCount: '0', requiredCoaches: 2, note: '包班', employeeId: 16, employeeName: '李四' },
  { id: 17, date: '2026-07-08', weekNo: 2, venueId: 3, venueName: '', courseName: '夏令營', startTime: '08:00', endTime: '10:00', registeredCount: 6, requiredCoaches: 0, note: '' },
  { id: 18, date: '2026-07-14', weekNo: 3, venueId: 2, venueName: '新北高中', courseName: '別週課', startTime: '08:00', endTime: '09:00', registeredCount: 1, requiredCoaches: 1, note: '' },
];

const availability = [
  { employeeId: 9, employeeName: '王偉', submitted: true, venueNames: ['新北高中'], weekdaySlots: [{ startTime: '05:30', endTime: '12:00' }], weekdayDays: [1, 3], satSlots: [], sunSlots: [{ startTime: '07:00', endTime: '12:00' }], notes: '' },
  { employeeId: 16, employeeName: '李四', submitted: true, venueNames: ['全部'], weekdaySlots: [{ startTime: '08:00', endTime: '12:00' }], weekdayDays: [], satSlots: [{ startTime: '09:00', endTime: '10:00' }], sunSlots: [], notes: '可代班' },
  { employeeId: 13, employeeName: '劉承翰', submitted: false },
];

const payrollConfig = {
  hours: { 球類課程: '2', 補習班課程: '-1' },
  rates: { '游泳一般團班|教練': '450', '游泳一般團班|當班下': '135', '游泳一般團班|助教': '180', '游泳假日班|教練': '500', '幼兒游泳班|跟課': '100', '補習班課程|教練': '300', '球類課程|教練': '600' },
  mult: { 當班下: '0.3', 助教: '0.4' },
  typeOverrides: { 夏令營: '球類課程' },
  cramSchools: null,
  nameAliases: { 莊子宏: '莊子鋐', 路人甲: '不在名冊的人' },
  types: null,
};

const salaryRates = [
  { role: 'lifeguard', label: '救生', ratePerHour: 190 },
  { role: 'frontdesk', label: '櫃台', rate: 180 },
];

const dutyShifts = [
  { id: 88, venueId: 1, roleKind: 'lifeguard', date: '2026-07-06', startTime: '07:30:00', endTime: '12:00:00', employeeName: '陳美', employeeId: 5 },
  { id: 89, venueId: 1, roleKind: 'lifeguard', date: '2026-07-06', startTime: '11:00:00', endTime: '22:30:00', employeeName: '王偉', employeeId: 9 },
];

const pipelines = [
  {
    name: 'week2-full',
    fx: { weekNo: 2, employees, rawEntries: week2Entries, enrollment: week2Enrollment, manualCourses: week2Manual, payrollConfig, salaryRates, dutyShifts, availability },
  },
  {
    name: 'week1-partial-week',
    fx: {
      weekNo: 1,
      employees,
      rawEntries: [
        e(k(1, '新北高中-course-一般游泳_6足歲以上-A-weekday'), '王偉 12\n李四\n劉承翰 35'),
        e(k(1, '新北高中-course-一般游泳_6足歲以上-A-needed'), '2'),
        e(k(1, '新北高中-course-holiday-游泳假日班-B-sun'), '*侯凱捷'),
        e(k(1, '新北高中-course-holiday-游泳假日班-B-needed'), '2'),
        e(k(1, '三民高中-frontdesk-dutygrid-r1-d3'), '李四 0800-1200'),
        e(k(1, '三民高中-frontdesk-dutygrid-r2-d3'), '王偉 fd 0900-1300'),
        e(k(1, '新北高中-lifeguard-dutygrid-r1-d1'), '不存在的日子 救0800-1200'),
      ],
      enrollment: {
        status: 200,
        items: [
          { weekNo: 1, venueId: 2, courseName: '一般游泳(6足歲以上)', slotCode: 'A', registeredCount: 6 },
          { weekNo: 1, venueId: 2, courseName: '游泳假日班', slotCode: 'B', registeredCount: 3 },
        ],
      },
      manualCourses: [{ id: 21, date: '2026-07-01', weekNo: 1, venueId: 2, venueName: '新北高中', courseName: '補習班游泳', startTime: '16:00', endTime: '17:00', registeredCount: 2, requiredCoaches: 1, note: '' }],
      payrollConfig: null,
      salaryRates: [],
      dutyShifts: [],
      availability: [],
    },
  },
  {
    name: 'week3-enrollment-failed',
    fx: {
      weekNo: 3,
      employees,
      rawEntries: [
        e(k(3, '新北高中-course-一般游泳_6足歲以上-A-weekday'), '王偉 12'),
        e(k(3, '新北高中-course-一般游泳_6足歲以上-A-needed'), '2'),
        e(k(3, '新北高中-course-一般游泳_6足歲以上-B-enroll'), '5'),
        e(k(3, '新北高中-course-一般游泳_6足歲以上-B-enroll:override'), '1'),
        e(k(3, '新北高中-course-一般游泳_6足歲以上-B-needed'), '1'),
      ],
      enrollment: { status: 500 },
      manualCourses: [],
      payrollConfig: null,
      salaryRates: [],
      dutyShifts: [],
      availability: [],
    },
  },
];

module.exports = { pipelines, employees };
