import { describe, expect, it, vi } from "vitest";

const { mockDb, mockData } = vi.hoisted(() => ({
  mockDb: {},
  mockData: {},
}));

vi.mock("../../infra/db", () => ({
  db: mockDb,
}));



vi.mock("../line/lineSignature", () => ({
  isValidLineUserId: vi.fn(() => true),
}));

import {
  buildManualCourseShiftEntries,
  enrollmentRowOverlapsWeek,
  mergeShiftEntries,
  normalizeManualCourseCreateInput,
  normalizeManualCoursePatchInput,
} from "./summerSchedule.service";

describe("summer schedule manual course normalization", () => {
  it("normalizes a valid manual course create payload for DB storage", () => {
    const input = normalizeManualCourseCreateInput({
      weekNo: "2",
      date: "2026-07-06",
      venueId: "1",
      venueName: "新北高中",
      courseName: " 補習班游泳 ",
      startTime: "16:00",
      endTime: "17:00",
      registeredCount: "8",
      requiredCoaches: "2",
      note: "  包班  ",
    });

    expect(input).toEqual({
      weekNo: 2,
      date: "2026-07-06",
      venueId: 1,
      venueName: "新北高中",
      courseName: "補習班游泳",
      startTime: "16:00",
      endTime: "17:00",
      registeredCount: 8,
      requiredCoaches: 2,
      employeeId: null,
      employeeName: null,
      note: "包班",
      status: "active",
    });
  });

  it("keeps manual course patch payloads to allowed DB fields only", () => {
    const patch = normalizeManualCoursePatchInput({
      id: 123,
      source: "manual",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      courseName: "外部合作課",
      registeredCount: "12",
      requiredCoaches: "3",
      note: "",
    });

    expect(patch).toEqual({
      courseName: "外部合作課",
      registeredCount: 12,
      requiredCoaches: 3,
      note: null,
    });
  });

  it("rejects invalid week numbers before writing manual courses", () => {
    expect(() =>
      normalizeManualCourseCreateInput({
        weekNo: "10",
        date: "2026-07-06",
        venueId: "1",
        courseName: "外部合作課",
        startTime: "16:00",
        endTime: "17:00",
      }),
    ).toThrow("weekNo 只允許 1-9");
  });
});

describe("summer schedule enrollment week matching", () => {
  it("keeps multi-week holiday terms in every overlapping summer week", () => {
    const holidayJulyTerm = {
      termStartDate: "2026-07-04",
      termEndDate: "2026-07-26",
    };

    expect(enrollmentRowOverlapsWeek(holidayJulyTerm, { startDate: "2026-07-01", endDate: "2026-07-05" })).toBe(true);
    expect(enrollmentRowOverlapsWeek(holidayJulyTerm, { startDate: "2026-07-06", endDate: "2026-07-12" })).toBe(true);
    expect(enrollmentRowOverlapsWeek(holidayJulyTerm, { startDate: "2026-07-13", endDate: "2026-07-19" })).toBe(true);
    expect(enrollmentRowOverlapsWeek(holidayJulyTerm, { startDate: "2026-07-20", endDate: "2026-07-26" })).toBe(true);
    expect(enrollmentRowOverlapsWeek(holidayJulyTerm, { startDate: "2026-07-27", endDate: "2026-08-02" })).toBe(false);
  });

  it("keeps one-week terms matched by their start date behavior", () => {
    const weekdayTerm = {
      termStartDate: "2026-07-06",
      termEndDate: "2026-07-10",
    };

    expect(enrollmentRowOverlapsWeek(weekdayTerm, { startDate: "2026-07-01", endDate: "2026-07-05" })).toBe(false);
    expect(enrollmentRowOverlapsWeek(weekdayTerm, { startDate: "2026-07-06", endDate: "2026-07-12" })).toBe(true);
    expect(enrollmentRowOverlapsWeek(weekdayTerm, { startDate: "2026-07-13", endDate: "2026-07-19" })).toBe(false);
  });
});

describe("summer schedule manual course publish rows", () => {
  it("builds coach shift rows from manual courses and raw assignment employee meta", () => {
    const rows = buildManualCourseShiftEntries(
      [
        {
          id: 42,
          weekNo: 2,
          date: "2026-07-06",
          venueId: 1,
          courseName: "補習班游泳",
          startTime: "16:00",
          endTime: "17:00",
          registeredCount: 8,
          requiredCoaches: 1,
          status: "active",
        },
      ],
      [
        {
          key: "w2-三重商工-manual-42-coach",
          value: "小明",
          employees: [{ employeeId: 7, employeeName: "小明" }],
        },
      ],
      2,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        employeeId: 7,
        venueId: 1,
        date: "2026-07-06",
        startTime: "16:00",
        endTime: "17:00",
        role: "教練",
        manualCourseId: "42",
        slotCode: "MANUAL",
      }),
    ]);
    expect(rows[0].notes).toContain("手動課程");
    expect(rows[0].notes).toContain("manualCourseId:42");
  });

  it("deduplicates manual course rows already present in saved shift entries", () => {
    const existing = {
      employeeId: 7,
      venueId: 1,
      date: "2026-07-06",
      startTime: "16:00",
      endTime: "17:00",
      role: "教練",
      manualCourseId: "42",
    };

    expect(mergeShiftEntries([existing], [{ ...existing, notes: "手動課程" }])).toHaveLength(1);
  });
});
