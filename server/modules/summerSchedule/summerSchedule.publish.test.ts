import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockData, mockRepo, tx, lockXact } = vi.hoisted(() => ({
  mockData: { getAllEmployees: vi.fn(), getAllVenues: vi.fn(), getAllShiftsByDateRange: vi.fn(), deleteShift: vi.fn(), createShift: vi.fn() },
  mockRepo: { getDraft: vi.fn(), getActiveManualCourses: vi.fn() },
  tx: { name: "tx" },
  lockXact: vi.fn(async () => undefined),
}));

vi.mock("../../infra/db", () => ({ db: {} }));
vi.mock("../../infra/db/tx", () => ({ LOCK_NS: { summerWeek: 106, cramImport: 107 }, lockXact, withTx: (fn: (inner: unknown) => unknown) => fn(tx) }));
vi.mock("./summerSchedule.repository", () => ({ DRAFT_VERSION: "v40", summerScheduleRepository: mockRepo }));
vi.mock("../employee/employee.repository", () => ({ employeeRepository: mockData }));
vi.mock("../shift/shift.repository", () => ({ shiftRepository: mockData }));
vi.mock("../venue/venue.repository", () => ({ venueRepository: mockData }));
vi.mock("../line/lineSignature", () => ({ isValidLineUserId: vi.fn(() => true) }));

import { summerScheduleService } from "./summerSchedule.service";

const TAG = "暑假排班v40｜weekNo=1";
const good = { employeeId: 3, venueId: 10, date: "2026-07-02", startTime: "09:00", endTime: "12:00", role: "教練" };
const published = (id: number, over: Record<string, unknown> = {}) => ({ id, ...good, startTime: "09:00:00", endTime: "12:00:00", notes: TAG, status: "active", ...over });
const withDraft = (shiftEntries: unknown[]) => mockRepo.getDraft.mockResolvedValue({ version: "v40", weekNo: 1, rawEntries: [], assignments: [], shiftEntries });

beforeEach(() => {
  vi.clearAllMocks();
  mockData.getAllEmployees.mockResolvedValue([{ id: 3, status: "inactive" }]);
  mockData.getAllVenues.mockResolvedValue([{ id: 10 }]);
  mockData.getAllShiftsByDateRange.mockResolvedValue([]);
  mockRepo.getActiveManualCourses.mockResolvedValue([]);
  mockRepo.getDraft.mockResolvedValue(undefined);
});

describe("summer publish (GitHub #8)", () => {
  it("takes the week's lock inside the publish transaction", async () => {
    withDraft([good]);
    await summerScheduleService.publishShifts({ weekNo: 1 });
    expect(lockXact).toHaveBeenCalledWith(tx, 106, 1);
    expect(mockRepo.getDraft).toHaveBeenCalledWith(1, tx);
  });

  it("a draft with one invalid row is rejected with 422 and the published week is untouched", async () => {
    withDraft([good, { employeeId: 3, date: "2026-07-03" }]);
    const error: any = await summerScheduleService.publishShifts({ weekNo: 1 }).catch((e) => e);
    expect([error.status, error.extra]).toEqual([422, { errorCode: "SUMMER_PUBLISH_INVALID_ROWS", problems: [{ index: 1, code: "missing_field" }] }]);
    expect(error.message).toBe("第 1 週有 1 筆班次資料有誤（缺少員工、場館、日期或時間 1 筆），已取消發布，員工現有班表沒有變動");
    expect(mockData.deleteShift).not.toHaveBeenCalled();
    expect(mockData.createShift).not.toHaveBeenCalled();
  });

  it("an empty week is refused with 422 instead of reporting success with 0 inserted", async () => {
    mockData.getAllShiftsByDateRange.mockResolvedValue([published(77)]);
    const error: any = await summerScheduleService.publishShifts({ weekNo: 1 }).catch((e) => e);
    expect([error.status, error.extra]).toEqual([422, { errorCode: "SUMMER_PUBLISH_EMPTY", success: false, inserted: 0 }]);
    expect(mockData.deleteShift).not.toHaveBeenCalled();
  });

  it("a changed shift is cancelled and its replacement added, in the same transaction", async () => {
    withDraft([good]);
    mockData.getAllShiftsByDateRange.mockResolvedValue([published(77, { endTime: "11:00:00" }), { ...published(78), notes: "一般班" }]);
    const result = await summerScheduleService.publishShifts({ weekNo: 1 });
    expect(result).toEqual({ success: true, message: "已發布到員工前台", inserted: 1, created: 1, unchanged: 0, cancelled: 1, skipped: 0 });
    expect(mockData.deleteShift).toHaveBeenCalledWith(77, "summer-schedule-publish", "重新發布暑假排班", true, tx);
    expect(mockData.createShift).toHaveBeenCalledWith({ ...good, notes: TAG }, "summer-schedule-publish", tx);
  });

  it("an unchanged week writes nothing", async () => {
    withDraft([good]);
    mockData.getAllShiftsByDateRange.mockResolvedValue([published(77)]);
    const result = await summerScheduleService.publishShifts({ weekNo: 1 });
    expect([result.inserted, result.unchanged]).toEqual([1, 1]);
    expect(mockData.deleteShift).not.toHaveBeenCalled();
    expect(mockData.createShift).not.toHaveBeenCalled();
  });

  it("shifts sent in the request are ignored; the stored draft is published", async () => {
    withDraft([good]);
    await summerScheduleService.publishShifts({ weekNo: 1, shifts: [{ ...good, date: "2026-07-05" }] });
    expect(mockData.createShift).toHaveBeenCalledTimes(1);
    expect(mockData.createShift).toHaveBeenCalledWith({ ...good, notes: TAG }, "summer-schedule-publish", tx);
  });
});
