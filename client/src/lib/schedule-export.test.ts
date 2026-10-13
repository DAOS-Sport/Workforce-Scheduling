// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildScheduleExportRows } from "./schedule-export";

const LEAVE = ["休假", "特休"];
const employee = (id: number, name: string, status = "active") => ({ id, name, employeeCode: "E" + id, role: "救生", employmentType: "part_time", regionId: 1, status });
const shift = (id: number, employeeId: number, date: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
  ({ id, employeeId, venueId: 1, date, startTime: start, endTime: end, role: "救生", isDispatch: false, notes: null, status: "active", ...extra }) as any;
const venues = new Map<number, any>([[1, { id: 1, shortName: "一館", regionId: 1 }], [2, { id: 2, shortName: "二館", regionId: 2 }]]);
const regions = [{ id: 1, name: "甲區", code: "A" }, { id: 2, name: "乙區", code: "B" }] as any[];
const templates = [
  { id: 1, venueId: 1, dayType: "weekday", shiftLabel: "早班", startTime: "06:00", endTime: "14:00", role: "救生", requiredCount: 1 },
  { id: 2, venueId: 1, dayType: "weekend", shiftLabel: "早班", startTime: "06:00", endTime: "14:00", role: "救生", requiredCount: 1 },
  { id: 3, venueId: 1, dayType: "weekday", shiftLabel: "晚班", startTime: "14:00", endTime: "22:00", role: "救生", requiredCount: 1 },
  { id: 4, venueId: 1, dayType: "weekday", shiftLabel: "A", startTime: "09:00", endTime: "12:00", role: "救生", requiredCount: 1 },
  { id: 5, venueId: 1, dayType: "weekend", shiftLabel: "B", startTime: "09:00", endTime: "12:00", role: "救生", requiredCount: 1 },
] as any[];
const base = { dispatchShifts: [] as any[], venues, regions, templates, leaveTypes: LEAVE, startDate: "2026-09-01", endDate: "2026-09-30" };

describe("schedule export rows", () => {
  it("gives one row per shift: three early and three late shifts on a day make six rows", () => {
    const employees = [1, 2, 3, 4, 5, 6].map((id) => employee(id, "員工" + id));
    const shifts = [
      ...[1, 2, 3].map((id) => shift(id, id, "2026-09-23", "06:00:00", "14:00:00")),
      ...[4, 5, 6].map((id) => shift(id, id, "2026-09-23", "14:00:00", "22:00:00")),
    ];
    const rows = buildScheduleExportRows({ ...base, shifts, employees });
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r["班別"])).toEqual(["早班", "早班", "早班", "晚班", "晚班", "晚班"]);
    expect(rows[0]).toEqual({
      "日期": "2026-09-23", "星期": "三", "區域": "甲區", "場館": "一館", "姓名": "員工1", "員工編號": "E1",
      "身分": "在職", "職務": "救生", "班別": "早班", "開始": "06:00", "結束": "14:00", "派遣": "", "備註": "",
    });
  });

  it("gives an employee with two shifts on the same day two rows", () => {
    const rows = buildScheduleExportRows({
      ...base, employees: [employee(1, "員工1")],
      shifts: [shift(1, 1, "2026-09-05", "14:00:00", "22:00:00"), shift(2, 1, "2026-09-05", "06:00:00", "14:00:00")],
    });
    expect(rows.map((r) => r["開始"])).toEqual(["06:00", "14:00"]);
  });

  it("only exports the employees that are shown, and marks resigned ones", () => {
    const rows = buildScheduleExportRows({
      ...base, employees: [employee(1, "員工1"), employee(2, "員工2", "inactive")],
      shifts: [shift(1, 1, "2026-09-02", "06:00:00", "14:00:00"), shift(2, 2, "2026-09-03", "06:00:00", "14:00:00"), shift(3, 9, "2026-09-04", "06:00:00", "14:00:00")],
    });
    expect(rows.map((r) => [r["姓名"], r["身分"]])).toEqual([["員工1", "在職"], ["員工2", "離職"]]);
  });

  it("leaves out shifts outside the month", () => {
    const rows = buildScheduleExportRows({
      ...base, employees: [employee(1, "員工1")],
      shifts: [shift(1, 1, "2026-08-31", "06:00:00", "14:00:00"), shift(2, 1, "2026-09-01", "06:00:00", "14:00:00"), shift(3, 1, "2026-10-01", "06:00:00", "14:00:00")],
    });
    expect(rows.map((r) => r["日期"])).toEqual(["2026-09-01"]);
  });

  it("shows leave without times and leaves the label blank when templates disagree or none fits", () => {
    const rows = buildScheduleExportRows({
      ...base, employees: [employee(1, "員工1")],
      shifts: [
        shift(1, 1, "2026-09-01", "09:00:00", "18:00:00", { role: "特休" }),
        shift(2, 1, "2026-09-02", "09:00:00", "12:00:00"),
        shift(3, 1, "2026-09-03", "10:00:00", "11:00:00"),
      ],
    });
    expect(rows.map((r) => [r["職務"], r["班別"], r["開始"], r["結束"]])).toEqual([
      ["特休", "", "", ""],
      ["救生", "", "09:00", "12:00"],
      ["救生", "", "10:00", "11:00"],
    ]);
  });

  it("adds active dispatch personnel as their own rows", () => {
    const dispatch = (id: number, status: string) => ({ id, regionId: 2, venueId: null, date: "2026-09-10", startTime: "08:00", endTime: "12:00", dispatchName: "外派" + id, dispatchCompany: "某公司", dispatchPhone: null, role: "救生", notes: "代班", linkedEmployeeId: null, status });
    const rows = buildScheduleExportRows({ ...base, employees: [], shifts: [], dispatchShifts: [dispatch(1, "active"), dispatch(2, "cancelled")] as any[] });
    expect(rows).toEqual([{
      "日期": "2026-09-10", "星期": "四", "區域": "乙區", "場館": "", "姓名": "外派1", "員工編號": "",
      "身分": "派遣人員", "職務": "救生", "班別": "", "開始": "08:00", "結束": "12:00", "派遣": "是", "備註": "某公司／代班",
    }]);
  });
});
