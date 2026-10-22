import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockData } = vi.hoisted(() => ({
  mockData: {
    getSystemConfig: vi.fn(),
    getEmployee: vi.fn(),
    getShiftsByEmployeesAndDateRange: vi.fn(),
    getApprovedOvertimeByDateRange: vi.fn(),
    createShift: vi.fn(),
    createDispatchShift: vi.fn(),
    updateShift: vi.fn(),
  },
}));

vi.mock("../dispatch/dispatch.repository", () => ({ dispatchRepository: mockData }));
vi.mock("../employee/employee.repository", () => ({ employeeRepository: mockData }));
vi.mock("../overtime/overtime.repository", () => ({ overtimeRepository: mockData }));
vi.mock("./shift.repository", () => ({ shiftRepository: mockData }));
vi.mock("../system/system.repository", () => ({ systemRepository: mockData }));

import { importShifts } from "./shift.service";

const item = { employeeId: 1, venueId: 5, date: "2026-11-03", startTime: "09:00", endTime: "12:00", role: "救生" };

beforeEach(() => {
  vi.clearAllMocks();
  mockData.getEmployee.mockResolvedValue({ id: 1, status: "active" });
  mockData.getShiftsByEmployeesAndDateRange.mockResolvedValue([]);
  mockData.getApprovedOvertimeByDateRange.mockResolvedValue([]);
  mockData.createShift.mockImplementation(async (data: object) => ({ id: 99, ...data }));
});

describe("importShifts four-week reference date", () => {
  it("an empty four_week_reference_date falls back to 2025-01-06 like the other shift paths", async () => {
    mockData.getSystemConfig.mockResolvedValue({ key: "four_week_reference_date", value: "" });
    const result: any = await importShifts({ shifts: [item] }, "admin");
    expect(result.created).toBe(1);
  });

  it("a missing setting also uses the default", async () => {
    mockData.getSystemConfig.mockResolvedValue(undefined);
    const result: any = await importShifts({ shifts: [item] }, "admin");
    expect(result.created).toBe(1);
  });
});
