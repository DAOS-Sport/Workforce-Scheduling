import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage", () => ({
  storage: {
    getShiftsByDate: vi.fn(),
    getAllVenues: vi.fn(),
    getDispatchShiftsByDate: vi.fn(),
    getEmployee: vi.fn(),
    getShift: vi.fn(),
    getShiftsByEmployeeAndDateRange: vi.fn(),
    getDispatchShift: vi.fn(),
    getDispatchShiftsByLinkedEmployee: vi.fn(),
  },
}));

vi.mock("../availability/availability.repository", () => ({
  availabilityRepository: {},
}));

vi.mock("./lineHelpers", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getTaiwanNow: vi.fn(() => new Date(2026, 6, 3, 19, 0, 0)),
  };
});

import { storage } from "../../storage";
import { sendShiftReminders } from "./linePush.service";

const shift = {
  id: 10,
  employeeId: 1,
  venueId: 2,
  date: "2026-07-04",
  startTime: "09:00",
  endTime: "18:00",
  role: "救生",
  isDispatch: false,
  dispatchCompany: null,
  dispatchName: null,
  dispatchPhone: null,
  certificateImageUrl: null,
  notes: null,
  status: "active",
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
};

const employee = {
  id: 1,
  name: "王小明",
  employeeCode: "E001",
  lineId: "U1234567890abcdef1234567890abcdef",
  phone: null,
  email: null,
  regionId: 1,
  status: "active",
  role: "救生",
  employmentType: "part_time",
  isAdmin: false,
  department: null,
  isException: false,
};

describe("sendShiftReminders shift review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.mocked(storage.getAllVenues).mockResolvedValue([
      { id: 2, name: "測試館", shortName: "測試", regionId: 1 } as any,
    ]);
    vi.mocked(storage.getDispatchShiftsByDate).mockResolvedValue([]);
    vi.mocked(storage.getEmployee).mockResolvedValue(employee as any);
    vi.mocked(storage.getShiftsByEmployeeAndDateRange).mockResolvedValue([]);
    vi.mocked(storage.getDispatchShift).mockResolvedValue(undefined as any);
    vi.mocked(storage.getDispatchShiftsByLinkedEmployee).mockResolvedValue([]);
  });

  it("pushes when the candidate shift is still active at send time", async () => {
    vi.mocked(storage.getShiftsByDate).mockResolvedValue([shift as any]);
    vi.mocked(storage.getShift).mockResolvedValue(shift as any);

    const result = await sendShiftReminders(true);

    expect(result).toEqual({ sent: 1, skipped: 0, noLineId: 0 });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("明日班表通知"),
      }),
    );
  });

  it("skips when the shift is cancelled before the LINE push", async () => {
    vi.mocked(storage.getShiftsByDate).mockResolvedValue([shift as any]);
    vi.mocked(storage.getShift).mockResolvedValue({ ...shift, status: "cancelled" } as any);

    const result = await sendShiftReminders(true);

    expect(result).toEqual({ sent: 0, skipped: 1, noLineId: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
