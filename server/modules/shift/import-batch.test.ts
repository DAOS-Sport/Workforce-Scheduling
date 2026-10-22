import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getSystemConfig: vi.fn(),
    getEmployee: vi.fn(),
    getShiftsByEmployeesAndDateRange: vi.fn(),
    getApprovedOvertimeByDateRange: vi.fn(),
    createShift: vi.fn(),
    createDispatchShift: vi.fn(),
    updateShift: vi.fn(),
  },
}));

vi.mock("../../storage", () => ({ storage: mockStorage }));

import { importShifts } from "./shift.service";

const item = { employeeId: 1, venueId: 5, date: "2026-11-03", startTime: "09:00", endTime: "12:00", role: "救生" };

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getEmployee.mockResolvedValue({ id: 1, status: "active" });
  mockStorage.getShiftsByEmployeesAndDateRange.mockResolvedValue([]);
  mockStorage.getApprovedOvertimeByDateRange.mockResolvedValue([]);
  mockStorage.createShift.mockImplementation(async (data: object) => ({ id: 99, ...data }));
});

describe("importShifts four-week reference date", () => {
  it("an empty four_week_reference_date falls back to 2025-01-06 like the other shift paths", async () => {
    mockStorage.getSystemConfig.mockResolvedValue({ key: "four_week_reference_date", value: "" });
    const result: any = await importShifts({ shifts: [item] }, "admin");
    expect(result.created).toBe(1);
  });

  it("a missing setting also uses the default", async () => {
    mockStorage.getSystemConfig.mockResolvedValue(undefined);
    const result: any = await importShifts({ shifts: [item] }, "admin");
    expect(result.created).toBe(1);
  });
});
