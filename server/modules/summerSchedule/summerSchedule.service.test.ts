import { describe, expect, it, vi } from "vitest";

const { mockDb, mockStorage } = vi.hoisted(() => ({
  mockDb: {},
  mockStorage: {},
}));

vi.mock("../../db", () => ({
  db: mockDb,
}));

vi.mock("../../storage", () => ({
  storage: mockStorage,
}));

vi.mock("../line/lineSignature", () => ({
  isValidLineUserId: vi.fn(() => true),
}));

import {
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
