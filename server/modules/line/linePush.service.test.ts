import { beforeEach, describe, expect, it, vi } from "vitest";

const mockData = vi.hoisted(() => ({
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
}));

// pushOnce keeps its slots in the database; here a map stands in for push_dedup.
const slots = vi.hoisted(() => new Map<string, { status: string; attempts: number }>());
vi.mock("./pushDedup.repository", () => {
  const id = (k: { scope: string; period: string; employeeId: number; refId: string }) => [k.scope, k.period, k.employeeId, k.refId].join("|");
  return {
    pushDedupRepository: {
      claim: vi.fn(async (k) => {
        const row = slots.get(id(k));
        if (!row) { slots.set(id(k), { status: "pending", attempts: 1 }); return 1; }
        if (row.status !== "failed") return null;
        row.status = "pending";
        row.attempts += 1;
        return row.attempts;
      }),
      finish: vi.fn(async (k, status) => { slots.get(id(k))!.status = status; }),
      deleteOlderThan: vi.fn(async () => undefined),
    },
  };
});

vi.mock("../shift/shift.repository", () => ({ shiftRepository: mockData }));
vi.mock("../venue/venue.repository", () => ({ venueRepository: mockData }));
vi.mock("../dispatch/dispatch.repository", () => ({ dispatchRepository: mockData }));
vi.mock("../employee/employee.repository", () => ({ employeeRepository: mockData }));
vi.mock("../clock/clock.repository", () => ({ clockRepository: mockData }));
vi.mock("../system/system.repository", () => ({ systemRepository: mockData }));

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
    vi.mocked(mockData.getAllVenues).mockResolvedValue([
      { id: 2, name: "測試館", shortName: "測試", regionId: 1 } as any,
    ]);
    vi.mocked(mockData.getDispatchShiftsByDate).mockResolvedValue([]);
    vi.mocked(mockData.getEmployee).mockResolvedValue(employee as any);
    vi.mocked(mockData.getShiftsByEmployeeAndDateRange).mockResolvedValue([]);
    vi.mocked(mockData.getDispatchShift).mockResolvedValue(undefined as any);
    vi.mocked(mockData.getDispatchShiftsByLinkedEmployee).mockResolvedValue([]);
    vi.mocked(mockData.getAllShiftsByDateRange).mockResolvedValue([]);
    vi.mocked(mockData.getClockRecordsByDateRange).mockResolvedValue([]);
    vi.mocked(mockData.clearOldWeeklyPushNotifications).mockResolvedValue(undefined as any);
    vi.mocked(mockData.hasWeeklyPushNotification).mockResolvedValue(false);
    slots.clear();
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
    vi.mocked(mockData.getShiftsByDate).mockResolvedValue([shift as any]);
    vi.mocked(mockData.getShift).mockResolvedValue(shift as any);

    const result = await sendShiftReminders();

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
    vi.mocked(mockData.getShiftsByDate).mockResolvedValue([shift as any]);
    vi.mocked(mockData.getShift).mockResolvedValue({ ...shift, status: "cancelled" } as any);

    const result = await sendShiftReminders();

    expect(result).toEqual({ sent: 0, skipped: 1, noLineId: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips weekly schedule push when the shift is cancelled before sending", async () => {
    vi.mocked(mockData.getAllShiftsByDateRange).mockResolvedValue([{
      ...shift,
      date: "2026-07-06",
    } as any]);
    vi.mocked(mockData.getShift).mockResolvedValue({ ...shift, date: "2026-07-06", status: "cancelled" } as any);

    const result = await sendWeeklySchedulePush();

    expect(result).toEqual({ sent: 0, skipped: 1, noLineId: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send weekly late report for exactly 10 minutes late", async () => {
    vi.mocked(mockData.getAllShiftsByDateRange).mockResolvedValue([{
      ...shift,
      date: "2026-06-22",
      startTime: "09:00",
      endTime: "18:00",
    } as any]);
    vi.mocked(mockData.getClockRecordsByDateRange).mockResolvedValue([{
      id: 1,
      employeeId: 1,
      shiftId: shift.id,
      clockType: "in",
      clockTime: new Date("2026-06-22T01:10:00.000Z"),
      status: "success",
      failReason: "遲到 10 分鐘",
    } as any]);

    const result = await sendWeeklyLateReport();

    expect(result).toEqual({ sent: 0, skipped: 0, noLineId: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends weekly late report for more than 10 minutes late", async () => {
    vi.mocked(mockData.getAllShiftsByDateRange).mockResolvedValue([{
      ...shift,
      date: "2026-06-22",
      startTime: "09:00",
      endTime: "18:00",
    } as any]);
    vi.mocked(mockData.getClockRecordsByDateRange).mockResolvedValue([{
      id: 1,
      employeeId: 1,
      shiftId: shift.id,
      clockType: "in",
      clockTime: new Date("2026-06-22T01:11:00.000Z"),
      status: "success",
      failReason: "遲到 11 分鐘",
    } as any]);

    const result = await sendWeeklyLateReport();

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
