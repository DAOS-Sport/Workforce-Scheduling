/**
 * clockIn.service unit tests (services and the transaction are mocked; the real-database behavior is in the itests)
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

import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";
import { processClockIn as processClockInOutcome } from "./clockIn.service";
import { invalidateVenueCache } from "./venueCache";
import type { ClockType } from "../../core/clock/clockRules";

const tx = vi.hoisted(() => {
  const fake: Record<string, unknown> = { fake: true };
  fake.transaction = (fn: (inner: unknown) => unknown) => fn(fake);
  return fake;
});
vi.mock("../../infra/db/tx", () => ({
  LOCK_NS: { clock: 101 },
  lockXact: vi.fn(async () => undefined),
  withTx: (fn: (inner: unknown) => unknown) => fn(tx),
}));
vi.mock("../employee/employee.service", () => ({
  employeeService: { getEmployeesByLineId: vi.fn(), getEmployee: vi.fn() },
}));
vi.mock("../clock/clock.service", () => ({
  clockService: { getClockRecordsByEmployee: vi.fn(), createClockRecord: vi.fn() },
}));
vi.mock("../venue/venue.service", () => ({ venueService: { findAll: vi.fn() } }));
vi.mock("../shift/shift.service", () => ({ shiftService: { getShiftsByEmployeeAndDateRange: vi.fn() } }));
vi.mock("../overtime/overtime.service", () => ({ overtimeService: { getOvertimeRequestsByEmployeeAndDate: vi.fn() } }));

// ── 固定系統時鐘：2026-05-27 08:10（台北）＝ 00:10Z。打卡判斷用真實時間，所以不 mock getTaiwanNow，
// 而是固定 Date；紀錄時間一律用絕對時間 tp()，測試在 UTC 與 Asia/Taipei 時區都成立（GitHub #6）。
const tp = (hour: number, minute: number, second = 0, ms = 0) => new Date(Date.UTC(2026, 4, 27, hour - 8, minute, second, ms));

import { employeeService } from "../employee/employee.service";
import { lockXact } from "../../infra/db/tx";
import { clockService } from "../clock/clock.service";
import { venueService } from "../venue/venue.service";
import { shiftService } from "../shift/shift.service";
import { overtimeService } from "../overtime/overtime.service";

const processClockIn = async (params: { lineUserId?: string; employeeId?: number }, lat: number, lng: number, forcedClockType?: ClockType) =>
  (await processClockInOutcome(params, lat, lng, { forcedClockType })).result;

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
  clockTime: tp(8, 3), // 7 分鐘前 (超過 dedup 5 分鐘)
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

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(tp(8, 10));
  vi.clearAllMocks();
  invalidateVenueCache(); // 清除場館快取，確保每個測試都讀到最新 mock

  // 預設值：有員工、有場館、今天沒有打卡紀錄、有排班
  vi.mocked(employeeService.getEmployeesByLineId).mockResolvedValue([mockEmployee] as any);
  vi.mocked(employeeService.getEmployee).mockResolvedValue(mockEmployee as any);
  vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([]);
  vi.mocked(venueService.findAll).mockResolvedValue([mockVenue as any]);
  vi.mocked(shiftService.getShiftsByEmployeeAndDateRange).mockResolvedValue([mockShift as any]);
  vi.mocked(clockService.createClockRecord).mockResolvedValue({ id: 200, ...mockClockRecord } as any);
  vi.mocked(overtimeService.getOvertimeRequestsByEmployeeAndDate).mockResolvedValue([]);
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("processClockIn — 員工查找", () => {
  it("LINE ID 未綁定員工 → error", async () => {
    vi.mocked(employeeService.getEmployeesByLineId).mockResolvedValue([]);

    const result = await processClockIn({ lineUserId: "U_UNKNOWN" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("error");
    expect(result.failReason).toContain("尚未綁定");
  });

  it("員工狀態非 active → error", async () => {
    vi.mocked(employeeService.getEmployeesByLineId).mockResolvedValue([{ ...mockEmployee, status: "inactive" }] as any);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("error");
    expect(result.failReason).toContain("非在職");
  });
});

describe("processClockIn — 重複打卡防呆", () => {
  it("5 分鐘內同類型重複打卡 → fail 並寫入 audit 紀錄", async () => {
    const recentRecord = {
      ...mockClockRecord,
      clockTime: tp(8, 7), // 3 分鐘前，在 dedup 視窗內
    };
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([recentRecord as any]);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in");

    expect(result.status).toBe("fail");
    expect(result.failReason).toContain("重複打卡");
    expect(clockService.createClockRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "fail", failReason: expect.stringContaining("重複打卡") }), tx);
  });

  it("超過 5 分鐘的舊紀錄不觸發防呆", async () => {
    // mockClockRecord.clockTime 是 8:03，現在是 8:10 → 7 分鐘，不觸發
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([mockClockRecord as any]);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "out");

    expect(result.status).not.toBe("fail");
  });

  it("同一視窗內切換方向（in → out）不觸發防呆", async () => {
    const recentIn = {
      ...mockClockRecord,
      clockType: "in" as const,
      clockTime: tp(8, 7), // 3 分鐘前
    };
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([recentIn as any]);

    // 明確要求打 out，不應被 dedup
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "out");

    expect(result.status).not.toBe("fail");
  });

  it("下班後重複打卡 → 仍記為下班，可無限打卡（5 分鐘內也不擋、不翻回上班）", async () => {
    // 已上班(08:00) + 已下班(08:08)，現在 08:10：再打一次仍應是「下班」。
    const inRec = { ...mockClockRecord, id: 100, clockType: "in" as const, clockTime: tp(8, 0) };
    const outRec = { ...mockClockRecord, id: 101, clockType: "out" as const, clockTime: tp(8, 8) };
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([inRec, outRec] as any);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("success");
    expect(result.clockType).toBe("out");
    expect(clockService.createClockRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "success", clockType: "out" }), tx);
  });

  it("上班打卡後 2 分鐘內再次點 → 防呆，不翻成下班、不重複建檔", async () => {
    // 1 分鐘前剛上班成功，再點一次不應變成下班早退。
    const inRec = { ...mockClockRecord, id: 100, clockType: "in" as const, clockTime: tp(8, 9) };
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([inRec] as any);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.clockType).toBe("in");
    expect(result.status).toBe("success");
    expect(clockService.createClockRecord).not.toHaveBeenCalled();
  });
});

describe("processClockIn — 場館距離判斷", () => {
  it("系統沒有設定場館座標 → fail", async () => {
    vi.mocked(venueService.findAll).mockResolvedValue([
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
    expect(clockService.createClockRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "fail", failReason: "不在任何場館範圍內" }), tx);
  });

  it("GPS 在範圍內 → 不回傳 fail", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).not.toBe("fail");
    expect(result.distance).toBeLessThanOrEqual(300);
  });
});

describe("processClockIn — 排班比對", () => {
  it("在場館範圍內但今日無排班 → warning + 寫入紀錄", async () => {
    vi.mocked(shiftService.getShiftsByEmployeeAndDateRange).mockResolvedValue([]);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("warning");
    expect(result.failReason).toContain("無排班");
    expect(clockService.createClockRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "warning" }), tx);
  });

  it("在範圍內且有排班 → success + 寫入紀錄", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("success");
    expect(result.venueName).toBe("測試");
    expect(clockService.createClockRecord).toHaveBeenCalledWith(expect.objectContaining({ status: "success", employeeId: 1, venueId: 1 }), tx);
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
  it("上班時間後 10 分鐘內打卡 → 不標記遲到", async () => {
    // getTaiwanNow mock 回 08:10，班別 08:00 → 仍在 10 分鐘寬限內
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in");

    expect(result.status).toBe("success");
    expect(result.failReason).toBeNull();
  });

  it("上班時間後超過 10 分鐘打卡 → lateReason 包含「遲到」", async () => {
    vi.mocked(shiftService.getShiftsByEmployeeAndDateRange).mockResolvedValue([
      { ...mockShift, startTime: "07:59" } as any,
    ]);

    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in");

    expect(result.status).toBe("success");
    expect(result.failReason).toContain("遲到");
  });

  it("指定 clockType=out 時回傳 out", async () => {
    const result = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "out");

    expect(result.clockType).toBe("out");
  });

  it("可用 employeeId 取代 lineUserId", async () => {
    vi.mocked(employeeService.getEmployee).mockResolvedValue(mockEmployee as any);

    const result = await processClockIn({ employeeId: 1 }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(result.status).toBe("success");
    expect(employeeService.getEmployee).toHaveBeenCalledWith(1);
    expect(employeeService.getEmployee).toHaveBeenCalledWith(1, tx);
  });
});

describe("processClockIn — 時間間隔用真實時間（GitHub #6）", () => {
  it("重複打卡的 5 分鐘界線：4:59.999 擋、5:00 放行", async () => {
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([{ ...mockClockRecord, clockTime: tp(8, 5, 0, 1) } as any]);
    expect((await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in")).failReason).toContain("重複打卡");
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([{ ...mockClockRecord, clockTime: tp(8, 5) } as any]);
    expect((await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in")).failReason ?? "").not.toContain("重複打卡");
  });

  it("防誤翻的 2 分鐘界線：1:59.999 視為同一次上班、2:00 照常判斷", async () => {
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([{ ...mockClockRecord, clockTime: tp(8, 8, 0, 1) } as any]);
    const repeat = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);
    expect([repeat.clockType, repeat.failReason, repeat.time]).toEqual(["in", "您剛才已完成上班打卡，無需重複", "08:08"]);
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([{ ...mockClockRecord, clockTime: tp(8, 8) } as any]);
    expect((await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG)).failReason).not.toBe("您剛才已完成上班打卡，無需重複");
  });

  it("台北的日期與時刻來自絕對時間，不受伺服器時區影響", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 26, 16, 30)));
    const r = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in");
    expect([r.date, r.time]).toEqual(["2026-05-27", "00:30"]);
  });
});

describe("processClockIn — 用各館自己的半徑選館（GitHub #3，AC-3.1）", () => {
  it("近館半徑不夠、遠館半徑涵蓋時，打卡成功，場館、距離、半徑、班別都綁遠館", async () => {
    const near = { ...mockVenue, id: 1, shortName: "近館", latitude: 25.0 + 100 / 111320, radius: 50 };
    const far = { ...mockVenue, id: 2, shortName: "遠館", latitude: 25.0 - 150 / 111320, radius: 300 };
    vi.mocked(venueService.findAll).mockResolvedValue([near, far] as any);
    vi.mocked(shiftService.getShiftsByEmployeeAndDateRange).mockResolvedValue([{ ...mockShift, id: 2, venueId: 2 }] as any);

    const r = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect([r.status, r.clockType, r.venueName, r.distance, r.radius, r.shiftInfo]).toEqual(["success", "in", "遠館", 150, 300, "08:00-17:00"]);
    expect(clockService.createClockRecord).toHaveBeenCalledWith(expect.objectContaining({ venueId: 2, shiftId: 2, distance: 150, matchedVenueName: "遠館", status: "success" }), tx);
  });
});

describe("processClockIn — 序列化與時間", () => {
  it("打卡判斷在員工鎖內進行，鎖的鍵是員工 id", async () => {
    await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(lockXact).toHaveBeenCalledWith(tx, 101, 1);
  });

  it("找不到或非在職的員工不開交易、不拿鎖", async () => {
    vi.mocked(employeeService.getEmployeesByLineId).mockResolvedValue([]);
    await processClockIn({ lineUserId: "U_UNKNOWN" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(lockXact).not.toHaveBeenCalled();
  });

  it("鎖內重讀員工：排隊期間被停用就擋下", async () => {
    vi.mocked(employeeService.getEmployee).mockResolvedValue({ ...mockEmployee, status: "inactive" } as any);

    const r = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect([r.status, r.failReason]).toEqual(["error", "帳號目前為非在職狀態"]);
    expect(clockService.createClockRecord).not.toHaveBeenCalled();
  });

  it("紀錄時間寫的是打卡當下（或 LINE 事件時間），不是資料庫交易開始的時間", async () => {
    const eventTime = tp(8, 9);
    await processClockInOutcome({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, { at: eventTime });

    expect(clockService.createClockRecord).toHaveBeenCalledWith(expect.objectContaining({ clockTime: eventTime }), tx);
  });

  it("LINE 事件時間略早於剛提交的上班紀錄（兩邊同時打卡）仍視為同一次上班，不翻成下班", async () => {
    const justCommitted = { ...mockClockRecord, id: 100, clockType: "in" as const, clockTime: tp(8, 10, 3) };
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([justCommitted] as any);

    const outcome = await processClockInOutcome({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, { at: tp(8, 10, 1) });

    expect([outcome.result.status, outcome.result.clockType]).toEqual(["success", "in"]);
    expect(clockService.createClockRecord).not.toHaveBeenCalled();
  });

  it("重複打卡的稽核紀錄寫失敗，仍回重複打卡的結果（稽核放在 savepoint 裡）", async () => {
    vi.mocked(clockService.getClockRecordsByEmployee).mockResolvedValue([{ ...mockClockRecord, clockTime: tp(8, 7) }] as any);
    vi.mocked(clockService.createClockRecord).mockRejectedValue(new Error("audit insert failed"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const r = await processClockIn({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG, "in");

    expect([r.status, r.failReason]).toEqual(["fail", expect.stringContaining("重複打卡")]);
  });
});

describe("processClockIn — 一個 LINE 帳號對到多筆員工資料（D1）", () => {
  const record = (id: number, regionId: number, status = "active") => ({ ...mockEmployee, id, regionId, status });

  it("停用的舊紀錄與在職的新紀錄並存 → 記在在職那筆", async () => {
    vi.mocked(employeeService.getEmployeesByLineId).mockResolvedValue([record(3, 1, "inactive"), record(9, 1)] as any);
    vi.mocked(employeeService.getEmployee).mockImplementation((async (id: number) => (id === 9 ? record(9, 1) : record(3, 1, "inactive"))) as any);

    const outcome = await processClockInOutcome({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect([outcome.result.status, outcome.employeeId]).toEqual(["success", 9]);
  });

  it("兩筆都在職、地區不同 → 依打卡場館所屬地區", async () => {
    vi.mocked(employeeService.getEmployeesByLineId).mockResolvedValue([record(3, 1), record(9, 2)] as any);
    vi.mocked(employeeService.getEmployee).mockImplementation((async (id: number) => record(id, id === 9 ? 2 : 1)) as any);
    vi.mocked(venueService.findAll).mockResolvedValue([{ ...mockVenue, regionId: 2 }] as any);

    const outcome = await processClockInOutcome({ lineUserId: "U123" }, IN_RANGE_LAT, IN_RANGE_LNG);

    expect(outcome.employeeId).toBe(9);
  });
});
