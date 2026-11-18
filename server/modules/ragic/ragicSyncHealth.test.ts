import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAll: vi.fn(),
  fetchH02: vi.fn(),
  getEmployees: vi.fn(),
  getObserved: vi.fn(),
  saveObserved: vi.fn(),
  claimEvents: vi.fn(),
  finishEvents: vi.fn(),
  purgeEvents: vi.fn(),
  hasPendingEvents: vi.fn(),
  findRegions: vi.fn(),
  trackJob: vi.fn(),
  saveSummary: vi.fn(),
}));

vi.mock("../../adapters/ragic", () => ({ fetchAllRagicRecords: mocks.fetchAll, fetchH02RagicRecords: mocks.fetchH02 }));
vi.mock("../../core/ragic/venueData", () => ({ VENUE_TO_REGION: { 測試部門甲: "A" }, VENUE_DATA: {} }));
vi.mock("../../infra/db/tx", () => ({
  LOCK_NS: { ragicSync: 1 },
  withTx: async (run: (tx: object) => Promise<unknown>) => run({}),
  withSessionLock: async (_namespace: number, _key: number, run: () => Promise<unknown>) => ({ acquired: true, value: await run() }),
}));
vi.mock("../../shared/health/healthState", () => ({ trackJob: mocks.trackJob }));
vi.mock("../../shared/log", () => ({ log: vi.fn() }));
vi.mock("../dispatch/dispatch.service", () => ({ dispatchService: { reconcileDispatchLinks: vi.fn() } }));
vi.mock("../employee/employee.service", () => ({ employeeService: { getAllEmployees: mocks.getEmployees } }));
vi.mock("../region/region.service", () => ({ regionService: { findAll: mocks.findRegions } }));
vi.mock("../venue/venue.service", () => ({ venueService: {} }));
vi.mock("./ragic.repository", () => ({ ragicRepository: {
  getObservedStatuses: mocks.getObserved,
  saveObservedStatuses: mocks.saveObserved,
  claimOpenEvents: mocks.claimEvents,
  finishEvents: mocks.finishEvents,
  purgeEventsDoneBefore: mocks.purgeEvents,
  hasPendingEvents: mocks.hasPendingEvents,
} }));

import { runRagicSync, type SyncResult } from "./ragic.service";

describe("Ragic employee-sync health summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RAGIC_API_KEY", "synthetic-ragic-key");
    mocks.fetchAll.mockResolvedValue({
      "1": { 姓名: "測試員甲", 員工編號: "T0001", 部門: ["測試未設定部門"], 應徵職務: ["救生員"], 聘雇類別: "兼職", 在職狀態: "在職" },
      "2": { 姓名: "測試員乙", 員工編號: "T0002", 部門: ["測試部門甲"], 應徵職務: ["教練"], 聘雇類別: "測試未知類別", 在職狀態: "在職" },
    });
    mocks.fetchH02.mockRejectedValue(new Error("synthetic H02 read failure"));
    mocks.findRegions.mockResolvedValue([{ id: 1, code: "A" }]);
    mocks.getEmployees.mockResolvedValue([]);
    mocks.getObserved.mockResolvedValue(new Map());
    mocks.saveObserved.mockResolvedValue(undefined);
    mocks.claimEvents.mockResolvedValue([]);
    mocks.finishEvents.mockResolvedValue(undefined);
    mocks.purgeEvents.mockResolvedValue(undefined);
    mocks.hasPendingEvents.mockResolvedValue(false);
    mocks.trackJob.mockImplementation(async (_job: string, _trigger: string, run: () => Promise<SyncResult>, summarize: (result: SyncResult) => unknown) => {
      const result = await run();
      mocks.saveSummary(summarize(result));
      return result;
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("summarizes all three error kinds as counts without employee or department text", async () => {
    const outcome = await runRagicSync("cron");

    expect(mocks.trackJob).toHaveBeenCalledWith("ragic.sync", "cron", expect.any(Function), expect.any(Function));
    expect(outcome).toMatchObject({ busy: false, result: { errorKinds: { noRegion: 1, badEmploymentType: 1, h02ReadFailed: 1 } } });
    expect(mocks.saveSummary).toHaveBeenCalledExactlyOnceWith({
      created: 0,
      updated: 0,
      deactivated: 0,
      skipped: 2,
      errors: 3,
      errorKinds: { noRegion: 1, badEmploymentType: 1, h02ReadFailed: 1 },
    });
    expect(JSON.stringify(mocks.saveSummary.mock.calls)).not.toMatch(/測試員甲|測試員乙|T0001|T0002|測試未設定部門|測試部門甲/);
  });

  it("resets the H02 failure count when the next sync reads H02 successfully", async () => {
    await runRagicSync("cron");
    mocks.fetchH02.mockResolvedValue({});

    const outcome = await runRagicSync("cron");

    expect(outcome).toMatchObject({ busy: false, result: { errorKinds: { noRegion: 1, badEmploymentType: 1, h02ReadFailed: 0 } } });
    expect(mocks.saveSummary.mock.calls.map(([summary]) => ({ errors: summary.errors, errorKinds: summary.errorKinds }))).toEqual([
      { errors: 3, errorKinds: { noRegion: 1, badEmploymentType: 1, h02ReadFailed: 1 } },
      { errors: 2, errorKinds: { noRegion: 1, badEmploymentType: 1, h02ReadFailed: 0 } },
    ]);
  });
});
