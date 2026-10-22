import { beforeEach, describe, expect, it, vi } from "vitest";
import { shifts } from "@shared/schema";

const { mockDb, mockData } = vi.hoisted(() => ({
  mockDb: { select: vi.fn() },
  mockData: { getAllEmployees: vi.fn(), getAllVenues: vi.fn(), deleteShift: vi.fn(), createShift: vi.fn() },
}));

vi.mock("../../infra/db", () => ({ db: mockDb }));
vi.mock("../employee/employee.repository", () => ({ employeeRepository: mockData }));
vi.mock("../shift/shift.repository", () => ({ shiftRepository: mockData }));
vi.mock("../venue/venue.repository", () => ({ venueRepository: mockData }));
vi.mock("../line/lineSignature", () => ({ isValidLineUserId: vi.fn(() => true) }));

import { summerScheduleService } from "./summerSchedule.service";

const oldShift = { id: 77, date: "2026-07-02", notes: "暑假排班v40｜weekNo=1", status: "active" };
const good = { employeeId: 3, venueId: 10, date: "2026-07-02", startTime: "09:00", endTime: "12:00", role: "教練" };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockImplementation(() => ({ from: (table: unknown) => ({ where: async () => (table === shifts ? [oldShift] : []) }) }));
  mockData.getAllEmployees.mockResolvedValue([{ id: 3, status: "inactive" }]);
  mockData.getAllVenues.mockResolvedValue([{ id: 10 }]);
});

describe("summer publish (GitHub #8)", () => {
  it("a batch with one invalid row is rejected with 422 and the published week is untouched", async () => {
    const error: any = await summerScheduleService.publishShifts({ weekNo: 1, shifts: [good, { employeeId: 3, date: "2026-07-03" }] }).catch((e) => e);
    expect([error.status, error.extra]).toEqual([422, { errorCode: "SUMMER_PUBLISH_INVALID_ROWS", problems: [{ index: 1, code: "missing_field" }] }]);
    expect(error.message).toBe("第 1 週有 1 筆班次資料有誤（缺少員工、場館、日期或時間 1 筆），已取消發布，員工現有班表沒有變動");
    expect(mockData.deleteShift).not.toHaveBeenCalled();
    expect(mockData.createShift).not.toHaveBeenCalled();
  });

  it("an all-invalid batch is rejected the same way instead of reporting success with 0 inserted", async () => {
    const error: any = await summerScheduleService.publishShifts({ weekNo: 1, shifts: [{ employeeId: 3 }] }).catch((e) => e);
    expect(error.status).toBe(422);
    expect(mockData.deleteShift).not.toHaveBeenCalled();
  });

  it("a valid batch replaces the week's published shifts", async () => {
    const result = await summerScheduleService.publishShifts({ weekNo: 1, shifts: [good] });
    expect(result).toEqual({ success: true, message: "已發布到員工前台", inserted: 1, skipped: 0 });
    expect(mockData.deleteShift).toHaveBeenCalledWith(77, "summer-schedule-publish", "重新發布暑假排班", true);
    expect(mockData.createShift).toHaveBeenCalledWith({ ...good, notes: "暑假排班v40｜weekNo=1" }, "summer-schedule-publish");
  });

  it("an empty batch is still refused without touching the week", async () => {
    const result = await summerScheduleService.publishShifts({ weekNo: 1, shifts: [] });
    expect(result.success).toBe(false);
    expect(mockData.deleteShift).not.toHaveBeenCalled();
  });
});
