import type { DayNo, IsoDate, VenueConfig, VenueName, WeekConfig, WeekNo } from './types';

const WEEK_ROWS = [
  {"no":1,"start":"2026-07-01","end":"2026-07-05","activeWeekdays":[3,4,5],"weekday":"07/01（三）－07/03（五）","sat":"07/04（六）","sun":"07/05（日）","label":"第一週｜07/01（三）－07/05（日）"},
  {"no":2,"start":"2026-07-06","end":"2026-07-12","activeWeekdays":[1,2,3,4,5],"weekday":"07/06（一）－07/10（五）","sat":"07/11（六）","sun":"07/12（日）","label":"第二週｜07/06（一）－07/12（日）"},
  {"no":3,"start":"2026-07-13","end":"2026-07-19","activeWeekdays":[1,2,3,4,5],"weekday":"07/13（一）－07/17（五）","sat":"07/18（六）","sun":"07/19（日）","label":"第三週｜07/13（一）－07/19（日）"},
  {"no":4,"start":"2026-07-20","end":"2026-07-26","activeWeekdays":[1,2,3,4,5],"weekday":"07/20（一）－07/24（五）","sat":"07/25（六）","sun":"07/26（日）","label":"第四週｜07/20（一）－07/26（日）"},
  {"no":5,"start":"2026-07-27","end":"2026-08-02","activeWeekdays":[1,2,3,4,5],"weekday":"07/27（一）－07/31（五）","sat":"08/01（六）","sun":"08/02（日）","label":"第五週｜07/27（一）－08/02（日）"},
  {"no":6,"start":"2026-08-03","end":"2026-08-09","activeWeekdays":[1,2,3,4,5],"weekday":"08/03（一）－08/07（五）","sat":"08/08（六）","sun":"08/09（日）","label":"第六週｜08/03（一）－08/09（日）"},
  {"no":7,"start":"2026-08-10","end":"2026-08-16","activeWeekdays":[1,2,3,4,5],"weekday":"08/10（一）－08/14（五）","sat":"08/15（六）","sun":"08/16（日）","label":"第七週｜08/10（一）－08/16（日）"},
  {"no":8,"start":"2026-08-17","end":"2026-08-23","activeWeekdays":[1,2,3,4,5],"weekday":"08/17（一）－08/21（五）","sat":"08/22（六）","sun":"08/23（日）","label":"第八週｜08/17（一）－08/23（日）"},
  {"no":9,"start":"2026-08-24","end":"2026-08-30","activeWeekdays":[1,2,3,4,5],"weekday":"08/24（一）－08/28（五）","sat":"08/29（六）","sun":"08/30（日）","label":"第九週｜08/24（一）－08/30（日）"},
] as const;

const VENUE_ROWS = [
  {
    venueId: 2, name: "新北高中", lifeguardMin: 2, lifeguardMax: 3,
    tags: ["救生 2－3 人","櫃台 1－2 人","平日課程 8 門＋假日班"],
    duty: [["1","05:30-08:00"],["2","08:00-10:00"],["3","10:00-12:00"],["4","12:00-14:00"],["5","14:00-17:00"],["6","17:00-20:00"],["7","20:00-22:30"]],
    courses: [
      { name: "一般游泳(6足歲以上)", slots: [{"code":"A","time":"07:30-09:00"},{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"D","time":"12:00-13:30"},{"code":"E","time":"13:30-15:00"},{"code":"F","time":"15:00-16:30"},{"code":"G","time":"16:30-18:00"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"},{"code":"J","time":"21:00-22:30"}] },
      { name: "幼幼班游泳", slots: [{"code":"A1","time":"09:00-10:00"},{"code":"A2","time":"14:00-15:00"},{"code":"A3","time":"18:00-19:00"},{"code":"A4","time":"19:00-20:00"},{"code":"A5","time":"20:00-21:00"}] },
      { name: "室內羽球課", slots: [{"code":"A","time":"07:30-09:00"},{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"D","time":"12:00-13:30"},{"code":"E","time":"13:30-15:00"},{"code":"F","time":"15:00-16:30"},{"code":"H","time":"18:00-19:30"}] },
      { name: "室外籃球課", slots: [{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"F","time":"15:00-16:30"}] },
      { name: "室內桌球課", slots: [{"code":"C","time":"10:30-12:00"},{"code":"E","time":"13:30-15:00"}] },
      { name: "棒球課(室內+室外)", slots: [{"code":"D","time":"12:00-13:30"},{"code":"F","time":"15:00-16:30"},{"code":"G","time":"16:30-18:00"},{"code":"H","time":"18:00-19:30"}] },
      { name: "玩水班", slots: [{"code":"C","time":"10:30-12:00"},{"code":"F","time":"15:00-16:30"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"}] },
      { name: "高階游泳班", slots: [{"code":"L","time":"08:00-10:00"},{"code":"M","time":"14:00-16:00"}] },
    ],
    holidayCourses: [
      { name: "游泳假日班", slots: [{"code":"A","time":"07:30-09:00"},{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"E","time":"13:30-15:00"},{"code":"F","time":"15:00-16:30"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"},{"code":"J","time":"21:00-22:30"}] },
    ],
  },
  {
    venueId: 1, name: "三重商工", lifeguardMin: 1, lifeguardMax: 2,
    tags: ["救生 1－2 人","櫃台 1－2 人","平日課程 5 門＋假日班"],
    duty: [["1","07:30-10:00"],["2","10:00-12:00"],["3","12:00-14:00"],["4","14:00-16:00"],["5","16:00-18:00"],["6","18:00-20:00"],["7","20:00-22:30"]],
    courses: [
      { name: "一般游泳(6足歲以上)", slots: [{"code":"A","time":"07:30-09:00"},{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"D","time":"12:00-13:30"},{"code":"E","time":"13:30-15:00"},{"code":"F","time":"15:00-16:30"},{"code":"G","time":"16:30-18:00"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"},{"code":"J","time":"21:00-22:30"}] },
      { name: "幼幼班游泳", slots: [{"code":"A1","time":"09:00-10:00"},{"code":"A2","time":"14:00-15:00"},{"code":"A3","time":"18:00-19:00"},{"code":"A4","time":"19:00-20:00"},{"code":"A5","time":"20:00-21:00"}] },
      { name: "室內羽球課", slots: [{"code":"A","time":"07:30-09:00"},{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"D","time":"12:00-13:30"},{"code":"E","time":"13:30-15:00"},{"code":"F","time":"15:00-16:30"},{"code":"G","time":"16:30-18:00"}] },
      { name: "室外籃球課", slots: [{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"F","time":"15:00-16:30"}] },
      { name: "玩水班", slots: [{"code":"C","time":"10:30-12:00"},{"code":"F","time":"15:00-16:30"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"}] },
    ],
    holidayCourses: [
      { name: "游泳假日班", slots: [{"code":"A","time":"07:30-09:00"},{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"E","time":"13:30-15:00"},{"code":"F","time":"15:00-16:30"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"},{"code":"J","time":"21:00-22:30"}] },
    ],
  },
  {
    venueId: 3, name: "三民高中", lifeguardMin: 1, lifeguardMax: 2,
    tags: ["救生 1－2 人","櫃台 1－2 人","平日課程 3 門＋假日班"],
    duty: [["1","07:30-10:00"],["2","10:00-12:00"],["3","12:00-14:00"],["4","14:00-16:00"],["5","16:00-18:00"],["6","18:00-20:00"],["7","20:00-22:00"]],
    courses: [
      { name: "一般游泳(6足歲以上)", slots: [{"code":"A","time":"07:30-09:00"},{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"D","time":"12:00-13:30"},{"code":"E","time":"13:30-15:00"},{"code":"F","time":"15:00-16:30"},{"code":"G","time":"16:30-18:00"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"},{"code":"J","time":"21:00-22:30"}] },
      { name: "幼幼班游泳", slots: [{"code":"A1","time":"09:00-10:00"},{"code":"A2","time":"14:00-15:00"},{"code":"A3","time":"18:00-19:00"},{"code":"A4","time":"19:00-20:00"},{"code":"A5","time":"20:00-21:00"}] },
      { name: "玩水班", slots: [{"code":"C","time":"10:30-12:00"},{"code":"F","time":"15:00-16:30"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"}] },
    ],
    holidayCourses: [
      { name: "游泳假日班", slots: [{"code":"A","time":"07:30-09:00"},{"code":"B","time":"09:00-10:30"},{"code":"C","time":"10:30-12:00"},{"code":"E","time":"13:30-15:00"},{"code":"F","time":"15:00-16:30"},{"code":"H","time":"18:00-19:30"},{"code":"I","time":"19:30-21:00"},{"code":"J","time":"21:00-22:30"}] },
    ],
  },
] as const;

export const WEEKS: readonly WeekConfig[] = WEEK_ROWS.map(w => ({
  ...w,
  no: w.no as WeekNo,
  start: w.start as IsoDate,
  end: w.end as IsoDate,
  activeWeekdays: w.activeWeekdays as readonly DayNo[],
}));

export const VENUES: readonly VenueConfig[] = VENUE_ROWS;

export const VENUE_ID_BY_NAME: Readonly<Record<VenueName, number>> = { 新北高中: 2, 三重商工: 1, 三民高中: 3 };

export const FRONTDESK_RULE = { min: 1, max: 2 } as const;

export const FORCE_OPEN_KEYWORDS: readonly string[] = ['仍排課', '開課', '照排', '保留教練', '手動排'];

export const COURSE_TYPES_DEFAULT = ['游泳一般團班', '游泳假日班', '幼兒游泳班', '補習班課程', '球類課程', '體育課(短)', '體育課(長)'] as const;

export const COURSE_TYPE_HOURS_DEFAULT: Readonly<Record<string, number>> = {
  游泳一般團班: 1.34,
  游泳假日班: 1.34,
  幼兒游泳班: 1.0,
  補習班課程: 1.0,
  球類課程: 1.5,
  '體育課(短)': 1.0,
  '體育課(長)': 2.0,
};

export const CRAM_SCHOOLS_DEFAULT: readonly string[] = ['加洲森林', '欣蓓', '樂獅', '新學林', '皇家達', '曼斯特', '空中美語', '立得', '立德', '斯塔', '小丑魚'];

export const PAYROLL_ROLES = ['教練', '當班下', '助教', '跟課'] as const;

export const MULTIPLIER_DEFAULT = { 當班下: 0.3, 助教: 0.4 } as const;

export function weekOptions(): { value: string; label: string }[] {
  return WEEKS.map((w, i) => ({ value: String(i), label: w.label }));
}

export function weekByNo(no: WeekNo): WeekConfig {
  const week = WEEKS[no - 1];
  if (!week || week.no !== no) throw new Error(`week ${no} is not configured`);
  return week;
}

export function isWeekNo(n: number): n is WeekNo {
  return WEEKS.some(w => w.no === n);
}
