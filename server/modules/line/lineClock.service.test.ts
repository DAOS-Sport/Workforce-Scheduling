/**
 * lineClock.service unit tests
 *
 * Covers every branch of processClockIn:
 *  - 員工不存在 / 非在職
 *  - 重複打卡防呆
 *  - 場館沒有座標
 *  - GPS 超出範圍 (fail)
 *  - 在範圍內但無排班 (warning)
 *  - 正常上班打卡 (success)
 *  - 正常下班打卡 (success)
 *  - 遲到標記
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { processClockIn, invalidateVenueCache } from "./lineClock.service";

// ── mock storage ──────────────────────────────────────────────────────────────
vi.mock("../../storage", () => ({
  storage: {
    getEmployeeByLineId: vi.fn(),
    getEmployee: vi.fn(),
    getClockRecordsByEmployee: vi.fn(),
    getAllVenues: vi.fn(),
    getShiftsByEmployeeAndDateRange: vi.fn(),
    createClockRecord: vi.fn(),
    getOvertimeRequestsByEmployeeAndDate: vi.fn(),
  },
}));

// ── mock getTaiwanNow so tests are time-stable ────────────────────────────────
vi.mock("./lineHelpers", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    // 2026-05-27 08:10 (台灣時間) — 上班時間之後 10 分鐘，適合大部分測試
    getTaiwanNow: vi.fn(() => new Date(2026, 4, 27, 8, 10, 0)),
  };
});

import { storage } from "../../storage";

// ── 測試資料 ──────────────────────────────────────────────────────────────────

const mockEmployee = {
  id: 1,
  name: "測試員工",
  employeeCode: "E001",
  lineId: "U123",
  status: "active",
  regionId: 1,
  role: "pt",
  employmentType: "full_time",
  isAdmin: false,
  phone: null,
  email: null,
  department: null,
  isException: false,
};

const mockVenue = {
  id: 1,
  name: "測試場館",
  shortName: "測試",
  regionId: 1,
  latitude: 25.0,
  longitude: 121.0,
  radius: 300,
  address: null,
  taxId: null,
  isInternal: false,
  operationType: null,
  openTime: null,
  closeTime: null,
};

const mockShift = {
  id: 1,
  employeeId: 1,
  venueId: 1,
  date: "2026-05-27",
  startTime: "08:00",
  endTime: "17:00",
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

const mockClockRecord = {
  id: 100,
  employeeId: 1,
  venueId: 1,
  shiftId: 1,
  clockType: "in" as const,
  clockTime: new Date(2026, 4, 27, 8, 3, 0), // 7 分鐘前 (超過 dedup 5 分鐘)
  latitude: 25.0,
  longitude: 121.0,
  distance: 0,
  status: "success" as const,
  failReason: null,
  matchedVenueName: "測試",
};

// 在場館內的座標 (距離 0m)
const IN_RANGE_LAT = 25.0;
const IN_RANGE_LNG = 121.0;

// 場館外的座標 (距離 ~11km)
const OUT_OF_RANGE_LAT = 25.1;
const OUT_OF_RANGE_LNG = 121.0;

// ── 共用 setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  invalidateVenueCache(); // 清除場館快取，確保每個測試都讀到最新 mock

  // 預設值：有員工、有場館、今天沒有打卡紀錄、有排班
  vi.mocked(storage.getEmployeeByLineId).mockResolvedValue(mockEmployee as any);
  vi.mocked(storage.getClockRecordsByEmployee).mockResolvedValue([]);
  vi.mocked(storage.getAllVenues).mockResolvedValue([mockVenue as any]);
  vi.mocked(storage.getShiftsByEmployeeAndDateRange).mockResolvedValue([mockShift as any]);
  vi.mocked(storage.createClockRecord).mockResolvedValue({ id: 200, ...mockClockRecord } as any);
  vi.mocked(storage.getOvertimeRequestsByEmployeeAndDate).mockResolvedValue([]);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("processClockIn — 員工查找", () => {
  it("LINE ID 未綁定員工 → error", async () => {
    vi.mocked(storage.getEmployeeByLineId).mockResolvedValue(undefined as any);

    const result = await processClockIn({ lineUserId: "U_UNKNOWN" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("error");
    expect(result.failReason).toContain("尚未綁定");
  });

  it("員工狀態非 active → error", async () => {
    vi.mocked(storage.getEmployeeByLineId).mockResolvedValue({
      ...mockEmployee,
      status: "inactive",
    } as any);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("error");
    expect(result.failReason).toContain("非在職");
  });
});

describe("processClockIn — 重複打卡防呆", () => {
  it("5 分鐘內同類型重複打卡 → fail 並寫入 audit 紀錄", async () => {
    const recentRecord = {
      ...mockClockRecord,
      clockTime: new Date(2026, 4, 27, 8, 7, 0), // 3 分鐘前，在 dedup 視窗內
    };
    vi.mocked(storage.getClockRecordsByEmployee).mockResolvedValue([recentRecord as any]);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in");

    expect(result.status).toBe("fail");
    expect(result.failReason).toContain("重複打卡");
    expect(storage.createClockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "fail", failReason: expect.stringContaining("重複打卡") })
    );
  });

  it("超過 5 分鐘的舊紀錄不觸發防呆", async () => {
    // mockClockRecord.clockTime 是 8:03，現在是 8:10 → 7 分鐘，不觸發
    vi.mocked(storage.getClockRecordsByEmployee).mockResolvedValue([mockClockRecord as any]);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "out");

    expect(result.status).not.toBe("fail");
  });

  it("同一視窗內切換方向（in → out）不觸發防呆", async () => {
    const recentIn = {
      ...mockClockRecord,
      clockType: "in" as const,
      clockTime: new Date(2026, 4, 27, 8, 7, 0), // 3 分鐘前
    };
    vi.mocked(storage.getClockRecordsByEmployee).mockResolvedValue([recentIn as any]);

    // 明確要求打 out，不應被 dedup
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "out");

    expect(result.status).not.toBe("fail");
  });

  it("下班後重複打卡 → 仍記為下班，可無限打卡（5 分鐘內也不擋、不翻回上班）", async () => {
    // 已上班(08:00) + 已下班(08:08)，現在 08:10：再打一次仍應是「下班」。
    const inRec = { ...mockClockRecord, id: 100, clockType: "in" as const, clockTime: new Date(2026, 4, 27, 8, 0, 0) };
    const outRec = { ...mockClockRecord, id: 101, clockType: "out" as const, clockTime: new Date(2026, 4, 27, 8, 8, 0) };
    vi.mocked(storage.getClockRecordsByEmployee).mockResolvedValue([inRec, outRec] as any);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("success");
    expect(result.clockType).toBe("out");
    expect(storage.createClockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", clockType: "out" })
    );
  });

  it("上班打卡後 2 分鐘內再次點 → 防呆，不翻成下班、不重複建檔", async () => {
    // 1 分鐘前剛上班成功，再點一次不應變成下班早退。
    const inRec = { ...mockClockRecord, id: 100, clockType: "in" as const, clockTime: new Date(2026, 4, 27, 8, 9, 0) };
    vi.mocked(storage.getClockRecordsByEmployee).mockResolvedValue([inRec] as any);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.clockType).toBe("in");
    expect(result.status).toBe("success");
    expect(storage.createClockRecord).not.toHaveBeenCalled();
  });
});

describe("processClockIn — 場館距離判斷", () => {
  it("系統沒有設定場館座標 → fail", async () => {
    vi.mocked(storage.getAllVenues).mockResolvedValue([
      { ...mockVenue, latitude: null, longitude: null } as any,
    ]);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("fail");
    expect(result.failReason).toContain("場館座標");
  });

  it("GPS 超出場館範圍 → fail + 寫入 fail 紀錄", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, OUT_OF_RANGE_LAT, OUT_OF_RANGE_LNG);

    expect(result.status).toBe("fail");
    expect(result.failReason).toBe("不在任何場館範圍內");
    expect(result.distance).toBeGreaterThan(300);
    expect(storage.createClockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "fail", failReason: "不在任何場館範圍內" })
    );
  });

  it("GPS 在範圍內 → 不回傳 fail", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).not.toBe("fail");
    expect(result.distance).toBeLessThanOrEqual(300);
  });
});

describe("processClockIn — 排班比對", () => {
  it("在場館範圍內但今日無排班 → warning + 寫入紀錄", async () => {
    vi.mocked(storage.getShiftsByEmployeeAndDateRange).mockResolvedValue([]);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("warning");
    expect(result.failReason).toContain("無排班");
    expect(storage.createClockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "warning" })
    );
  });

  it("在範圍內且有排班 → success + 寫入紀錄", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("success");
    expect(result.venueName).toBe("測試");
    expect(storage.createClockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", employeeId: 1, venueId: 1 })
    );
  });

  it("success 時回傳 employeeName", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);
    expect(result.employeeName).toBe("測試員工");
  });

  it("success 時回傳 distance 與 radius", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);
    expect(result.distance).toBeGreaterThanOrEqual(0);
    expect(result.radius).toBe(300);
  });
});

describe("processClockIn — 遲到 / 打卡類型", () => {
  it("上班時間後打卡 → lateReason 包含「遲到」", async () => {
    // getTaiwanNow mock 回 08:10，班別 08:00 → 遲到 10 分鐘
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in");

    expect(result.status).toBe("success");
    expect(result.failReason).toContain("遲到");
  });

  it("指定 clockType=out 時回傳 out", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "out");

    expect(result.clockType).toBe("out");
  });

  it("可用 employeeId 取代 lineUserId", async () => {
    vi.mocked(storage.getEmployee).mockResolvedValue(mockEmployee as any);

    const result = await processClockIn({ employeeId: 1 }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("success");
    expect(storage.getEmployee).toHaveBeenCalledWith(1);
  });
});
