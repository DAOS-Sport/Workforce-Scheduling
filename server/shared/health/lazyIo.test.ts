import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSystemConfig, mergeJsonConfig, getRegions, getRegionByCode, writeLogBatch, deleteLogsBefore } = vi.hoisted(() => ({
  getSystemConfig: vi.fn(), mergeJsonConfig: vi.fn(), getRegions: vi.fn(), getRegionByCode: vi.fn(),
  writeLogBatch: vi.fn(), deleteLogsBefore: vi.fn(),
}));
vi.mock("../../modules/system/system.repository", () => ({ systemRepository: { getSystemConfig, mergeJsonConfig } }));
vi.mock("../../modules/region/region.repository", () => ({ regionRepository: { getRegions, getRegionByCode } }));
vi.mock("../../infra/logs", () => ({ writeLogBatch, deleteLogsBefore }));

import { readIntegrationState, readJobState, trackJob } from "./healthState";
import { regionService } from "../../modules/region/region.service";
import { purgeOldLogs, startLogPersistence } from "../logging/persistence";
import { flushLogs, recordLog } from "../logging/collector";

beforeEach(() => {
  vi.resetAllMocks();
  mergeJsonConfig.mockResolvedValue(undefined);
  writeLogBatch.mockResolvedValue(undefined);
});

describe("deferred repository operations", () => {
  it("reads job and integration JSON from their existing keys", async () => {
    getSystemConfig.mockResolvedValue({ value: JSON.stringify({ lastStatus: "success" }) });
    expect(await readJobState("test.lazy-read")).toEqual({ lastStatus: "success" });
    expect(await readIntegrationState("line")).toEqual({ lastStatus: "success" });
    expect(getSystemConfig.mock.calls).toEqual([["health:job:test.lazy-read"], ["health:integration:line"]]);
  });

  it("persists a job's start and success while returning its result", async () => {
    expect(await trackJob("test.lazy-success", "manual", async () => 7, (count) => ({ count }))).toBe(7);
    expect(mergeJsonConfig).toHaveBeenNthCalledWith(1, "health:job:test.lazy-success", expect.objectContaining({ lastStatus: "running", lastTrigger: "manual" }), {});
    expect(mergeJsonConfig).toHaveBeenNthCalledWith(2, "health:job:test.lazy-success", expect.objectContaining({ lastStatus: "success", lastSummary: { count: 7 } }), { stampRecovery: true });
  });

  it("persists a failed job and returns its original error", async () => {
    const failure = new Error("test job failed");
    await expect(trackJob("test.lazy-failure", "cron", async () => { throw failure; })).rejects.toBe(failure);
    expect(mergeJsonConfig).toHaveBeenLastCalledWith("health:job:test.lazy-failure", expect.objectContaining({ lastStatus: "failed", lastError: "test job failed" }), {});
  });

  it("returns region repository results for both lookup operations", async () => {
    const region = { id: 1, code: "TEST" };
    getRegions.mockResolvedValue([region]);
    getRegionByCode.mockResolvedValue(region);
    expect(await regionService.findAll()).toEqual([region]);
    expect(await regionService.findByCode("TEST")).toBe(region);
    expect(getRegions).toHaveBeenCalledOnce();
    expect(getRegionByCode).toHaveBeenCalledWith("TEST");
  });

  it("persists startup and collected logs after the sink starts", async () => {
    const stop = startLogPersistence();
    try {
      recordLog("warn", "test warning", "test.lazy-log");
      await flushLogs();
      expect(writeLogBatch).toHaveBeenCalledWith([
        expect.objectContaining({ level: "info", pipeline: "server.restarts", message: "server.started" }),
        expect.objectContaining({ level: "warn", pipeline: "test.lazy-log", message: "test warning" }),
      ]);
    } finally {
      stop();
    }
  });

  it("purges logs older than fourteen days and returns the deleted count", async () => {
    deleteLogsBefore.mockResolvedValue(3);
    expect(await purgeOldLogs(new Date("2026-11-11T00:00:00Z"))).toBe(3);
    expect(deleteLogsBefore).toHaveBeenCalledWith(new Date("2026-10-28T00:00:00Z"));
  });
});
