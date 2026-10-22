import { describe, expect, it } from "vitest";
import { describeProblems, planSummerPublish } from "./summerPublish";

const week = { startDate: "2026-06-29", endDate: "2026-07-05" };
const refs = { employeeIds: new Set([3, 4]), venueIds: new Set([10]) };
const row = (over: Record<string, unknown> = {}) => ({ employeeId: 3, venueId: 10, date: "2026-07-02", startTime: "09:00", endTime: "12:00", ...over });

describe("summer publish plan (GitHub #8)", () => {
  it("all valid rows become shifts tagged with the week", () => {
    const plan = planSummerPublish([row(), row({ role: "櫃台", notes: "代班", date: "2026-07-05" })], week, 1, refs);
    expect(plan).toEqual({
      ok: true,
      shifts: [
        { employeeId: 3, venueId: 10, date: "2026-07-02", startTime: "09:00", endTime: "12:00", role: "教練", notes: "暑假排班v40｜weekNo=1" },
        { employeeId: 3, venueId: 10, date: "2026-07-05", startTime: "09:00", endTime: "12:00", role: "櫃台", notes: "代班｜暑假排班v40｜weekNo=1" },
      ],
    });
  });

  it("one bad row rejects the whole batch and reports row index and code only", () => {
    const plan = planSummerPublish([row(), row({ venueId: undefined })], week, 1, refs);
    expect(plan).toEqual({ ok: false, problems: [{ index: 1, code: "missing_field" }] });
  });

  it("each kind of bad row", () => {
    const bad = [
      row({ employeeId: 99 }),
      row({ venueId: 11 }),
      row({ date: "2026-07-06" }),
      row({ date: "2026-06-31" }),
      row({ startTime: "24:00" }),
      row({ endTime: "09:00" }),
    ];
    const plan = planSummerPublish(bad, week, 1, refs);
    expect(plan.ok ? [] : plan.problems.map((p) => p.code)).toEqual([
      "unknown_employee",
      "unknown_venue",
      "outside_week",
      "outside_week",
      "bad_time",
      "zero_length",
    ]);
  });

  it("an employee who has since left is still accepted", () => {
    expect(planSummerPublish([row({ employeeId: 4 })], week, 1, refs).ok).toBe(true);
  });

  it("an overnight shift and seconds in the time are accepted", () => {
    expect(planSummerPublish([row({ startTime: "22:00", endTime: "02:00" }), row({ startTime: "09:00:00", endTime: "12:00:00" })], week, 1, refs).ok).toBe(true);
  });

  it("summarises problems per kind", () => {
    expect(describeProblems([{ index: 0, code: "unknown_employee" }, { index: 2, code: "unknown_employee" }, { index: 3, code: "outside_week" }])).toBe("找不到員工 2 筆、日期不在本週 1 筆");
  });
});
