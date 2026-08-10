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
    getAllShiftsByDateRange: vi.fn(),
    getClockRecordsByDateRange: vi.fn(),
    clearOldWeeklyPushNotifications: vi.fn(),
    hasWeeklyPushNotification: vi.fn(),
    createWeeklyPushNotification: vi.fn(),
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
import { pushToLine, sendShiftReminders, sendWeeklyLateReport, sendWeeklySchedulePush } from "./linePush.service";

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
    vi.mocked(storage.getAllShiftsByDateRange).mockResolvedValue([]);
    vi.mocked(storage.getClockRecordsByDateRange).mockResolvedValue([]);
    vi.mocked(storage.clearOldWeeklyPushNotifications).mockResolvedValue(undefined as any);
    vi.mocked(storage.hasWeeklyPushNotification).mockResolvedValue(false);
    vi.mocked(storage.createWeeklyPushNotification).mockResolvedValue(undefined as any);
  });

  it("sends LINE pushes as decorated Flex cards with an outer border", async () => {
    await pushToLine(employee.lineId, "📋 明日班表通知\n測試內容");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));

    expect(body.messages[0]).toMatchObject({
      type: "flex",
      contents: {
        type: "bubble",
        body: {
          contents: [
            {
              contents: [
                expect.objectContaining({ type: "box" }),
                expect.objectContaining({ type: "separator" }),
                expect.objectContaining({ type: "text", text: expect.stringContaining("明日班表通知") }),
              ],
              borderWidth: "2px",
              cornerRadius: "18px",
            },
          ],
        },
      },
    });
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

  it("skips weekly schedule push when the shift is cancelled before sending", async () => {
    vi.mocked(storage.getAllShiftsByDateRange).mockResolvedValue([{
      ...shift,
      date: "2026-07-06",
    } as any]);
    vi.mocked(storage.getShift).mockResolvedValue({ ...shift, date: "2026-07-06", status: "cancelled" } as any);

    const result = await sendWeeklySchedulePush(true);

    expect(result).toEqual({ sent: 0, skipped: 1, noLineId: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send weekly late report for exactly 10 minutes late", async () => {
    vi.mocked(storage.getAllShiftsByDateRange).mockResolvedValue([{
      ...shift,
      date: "2026-06-22",
      startTime: "09:00",
      endTime: "18:00",
    } as any]);
    vi.mocked(storage.getClockRecordsByDateRange).mockResolvedValue([{
      id: 1,
      employeeId: 1,
      shiftId: shift.id,
      clockType: "in",
      clockTime: new Date("2026-06-22T01:10:00.000Z"),
      status: "success",
      failReason: "遲到 10 分鐘",
    } as any]);

    const result = await sendWeeklyLateReport(true);

    expect(result).toEqual({ sent: 0, skipped: 0, noLineId: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends weekly late report for more than 10 minutes late", async () => {
    vi.mocked(storage.getAllShiftsByDateRange).mockResolvedValue([{
      ...shift,
      date: "2026-06-22",
      startTime: "09:00",
      endTime: "18:00",
    } as any]);
    vi.mocked(storage.getClockRecordsByDateRange).mockResolvedValue([{
      id: 1,
      employeeId: 1,
      shiftId: shift.id,
      clockType: "in",
      clockTime: new Date("2026-06-22T01:11:00.000Z"),
      status: "success",
      failReason: "遲到 11 分鐘",
    } as any]);

    const result = await sendWeeklyLateReport(true);

    expect(result).toEqual({ sent: 1, skipped: 0, noLineId: 0 });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("上週出勤異常通知"),
      }),
    );
  });
});
