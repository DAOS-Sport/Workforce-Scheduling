import { describe, expect, it } from "vitest";
import { taipeiInstant } from "../time/taipei";
import {
  evaluateClockCoverage,
  evaluateDatabase,
  evaluateHolidayTable,
  evaluateIntegration,
  evaluateScheduledJob,
  evaluateSecurity,
  evaluateSyncJob,
  evaluateWebhook,
  lastExpectedRun,
} from "./rules";
import { worst } from "./types";

const T = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return taipeiInstant(date, h * 60 + m);
};
const iso = (date: string, hhmm: string) => T(date, hhmm).toISOString();
const base = { id: "x", name: "測試" };

describe("lastExpectedRun", () => {
  it("daily job: before grace ends it still points at yesterday", () => {
    const daily = { kind: "daily", at: 19 * 60 } as const;
    expect(lastExpectedRun(daily, T("2026-10-21", "19:29"), 30)).toEqual(T("2026-10-20", "19:00"));
    expect(lastExpectedRun(daily, T("2026-10-21", "19:30"), 30)).toEqual(T("2026-10-21", "19:00"));
  });

  it("weekly job: finds the most recent matching weekday", () => {
    const sundayNoon = { kind: "weekly", weekday: 0, at: 12 * 60 } as const;
    expect(lastExpectedRun(sundayNoon, T("2026-10-21", "08:00"), 30)).toEqual(T("2026-10-18", "12:00"));
  });

  it("every-30 job: uses the latest slot inside the window, else yesterday's last slot", () => {
    const every30 = { kind: "every30", from: 6 * 60, to: 21 * 60 + 30 } as const;
    expect(lastExpectedRun(every30, T("2026-10-21", "10:15"), 10)).toEqual(T("2026-10-21", "10:00"));
    expect(lastExpectedRun(every30, T("2026-10-21", "05:00"), 10)).toEqual(T("2026-10-20", "21:30"));
  });
});

describe("evaluateScheduledJob", () => {
  const daily = { ...base, schedule: { kind: "daily", at: 19 * 60 } as const, graceMinutes: 30, enabled: true, schedulerActive: true };

  it("green when the expected run succeeded", () => {
    const p = evaluateScheduledJob({ ...daily, now: T("2026-10-21", "20:00"), state: { lastStartedAt: iso("2026-10-21", "19:00"), lastSuccessAt: iso("2026-10-21", "19:01"), lastStatus: "success" } });
    expect(p.level).toBe("green");
  });

  it("red when the expected run is missing", () => {
    const p = evaluateScheduledJob({ ...daily, now: T("2026-10-21", "20:00"), state: { lastStartedAt: iso("2026-10-20", "19:00"), lastSuccessAt: iso("2026-10-20", "19:01"), lastStatus: "success" } });
    expect(p.level).toBe("red");
    expect(p.reason).toContain("10/21 19:00");
  });

  it("red when the latest run failed", () => {
    const p = evaluateScheduledJob({ ...daily, now: T("2026-10-21", "20:00"), state: { lastStartedAt: iso("2026-10-21", "19:00"), lastSuccessAt: iso("2026-10-20", "19:01"), lastFailureAt: iso("2026-10-21", "19:02"), lastError: "boom", lastStatus: "failed" } });
    expect([p.level, p.reason.includes("boom")]).toEqual(["red", true]);
  });

  it("red when a run is stuck for over an hour", () => {
    const p = evaluateScheduledJob({ ...daily, now: T("2026-10-21", "20:05"), state: { lastStartedAt: iso("2026-10-21", "19:00"), lastStatus: "running" } });
    expect(p.level).toBe("red");
  });

  it("yellow when there is no record yet, or the scheduler does not run here", () => {
    expect(evaluateScheduledJob({ ...daily, now: T("2026-10-21", "20:00") }).level).toBe("yellow");
    expect(evaluateScheduledJob({ ...daily, schedulerActive: false, now: T("2026-10-21", "20:00") }).level).toBe("yellow");
  });

  it("green when the feature flag is off", () => {
    expect(evaluateScheduledJob({ ...daily, enabled: false, now: T("2026-10-21", "20:00") }).level).toBe("green");
  });

  it("every-30 job: one missed slot is yellow, two is red", () => {
    const job = { ...base, schedule: { kind: "every30", from: 360, to: 1290 } as const, graceMinutes: 10, enabled: true, schedulerActive: true };
    const state = (hhmm: string) => ({ lastStartedAt: iso("2026-10-21", hhmm), lastSuccessAt: iso("2026-10-21", hhmm), lastStatus: "success" as const });
    expect(evaluateScheduledJob({ ...job, now: T("2026-10-21", "10:15"), state: state("10:00") }).level).toBe("green");
    expect(evaluateScheduledJob({ ...job, now: T("2026-10-21", "10:15"), state: state("09:30") }).level).toBe("yellow");
    expect(evaluateScheduledJob({ ...job, now: T("2026-10-21", "10:15"), state: state("09:00") }).level).toBe("red");
  });
});

describe("evaluateSyncJob", () => {
  const now = T("2026-10-21", "08:00");
  it("green within 26 hours, red after", () => {
    expect(evaluateSyncJob({ ...base, now, state: { lastStartedAt: iso("2026-10-20", "06:00"), lastSuccessAt: iso("2026-10-20", "06:00") } }).level).toBe("green");
    expect(evaluateSyncJob({ ...base, now, state: { lastStartedAt: iso("2026-10-20", "05:59"), lastSuccessAt: iso("2026-10-20", "05:59") } }).level).toBe("red");
  });
  it("yellow when the latest attempt failed or reported row errors", () => {
    expect(evaluateSyncJob({ ...base, now, state: { lastStartedAt: iso("2026-10-21", "07:00"), lastSuccessAt: iso("2026-10-21", "03:00"), lastFailureAt: iso("2026-10-21", "07:00") } }).level).toBe("yellow");
    expect(evaluateSyncJob({ ...base, now, state: { lastStartedAt: iso("2026-10-21", "03:00"), lastSuccessAt: iso("2026-10-21", "03:00"), lastSummary: { errors: 2 } } }).level).toBe("yellow");
  });
});

describe("evaluateWebhook", () => {
  it("failure turns red after an hour without a later success", () => {
    const state = { lastStartedAt: iso("2026-10-21", "07:00"), lastSuccessAt: iso("2026-10-21", "06:00"), lastFailureAt: iso("2026-10-21", "07:00") };
    expect(evaluateWebhook({ ...base, now: T("2026-10-21", "07:30"), state }).level).toBe("yellow");
    expect(evaluateWebhook({ ...base, now: T("2026-10-21", "08:01"), state }).level).toBe("red");
  });
});

describe("evaluateIntegration", () => {
  it("three consecutive failures is red, one is yellow", () => {
    const failed = { lastSuccessAt: iso("2026-10-21", "07:00"), lastFailureAt: iso("2026-10-21", "08:00"), lastError: "HTTP 500" };
    expect(evaluateIntegration({ ...base, state: { ...failed, consecutiveFailures: 1 } }).level).toBe("yellow");
    expect(evaluateIntegration({ ...base, state: { ...failed, consecutiveFailures: 3 } }).level).toBe("red");
    expect(evaluateIntegration({ ...base, state: { lastSuccessAt: iso("2026-10-21", "08:00") } }).level).toBe("green");
    expect(evaluateIntegration({ ...base }).level).toBe("yellow");
  });
});

describe("evaluateClockCoverage", () => {
  const c = (startedShifts: number, coveredShifts: number, attemptsToday = 0, failuresToday = 0) => evaluateClockCoverage({ ...base, coverage: { startedShifts, coveredShifts, attemptsToday, failuresToday } });
  it("thresholds", () => {
    expect(c(0, 0).level).toBe("green");
    expect(c(10, 1).level).toBe("red");
    expect(c(4, 0).level).toBe("yellow");
    expect(c(10, 4).level).toBe("yellow");
    expect(c(10, 9).level).toBe("green");
    expect(c(10, 9, 20, 5).level).toBe("yellow");
  });
});

describe("evaluateDatabase / evaluateHolidayTable / evaluateSecurity", () => {
  it("database latency buckets", () => {
    expect([evaluateDatabase({ ...base, latencyMs: 499 }).level, evaluateDatabase({ ...base, latencyMs: 500 }).level, evaluateDatabase({ ...base, latencyMs: 2000 }).level, evaluateDatabase({ ...base, latencyMs: null }).level]).toEqual(["green", "yellow", "red", "red"]);
  });
  it("holiday table expiry", () => {
    expect(evaluateHolidayTable({ ...base, lastDate: "2026-10-10", today: "2026-10-21" }).level).toBe("red");
    expect(evaluateHolidayTable({ ...base, lastDate: "2026-10-10", today: "2026-10-10" }).level).toBe("yellow");
    expect(evaluateHolidayTable({ ...base, lastDate: "2027-01-01", today: "2026-10-21" }).level).toBe("green");
  });
  it("security reports what is missing", () => {
    const ok = { mcpTokenSet: true, mcpTokenDistinct: true, sessionSecretSet: true, lineChannelSecretSet: true };
    expect(evaluateSecurity({ ...base, signals: ok }).level).toBe("green");
    const p = evaluateSecurity({ ...base, signals: { ...ok, mcpTokenDistinct: false } });
    expect([p.level, p.reason.includes("相同")]).toEqual(["red", true]);
  });
  it("worst", () => {
    expect(worst(["green", "yellow"])).toBe("yellow");
    expect(worst([])).toBe("green");
  });
});
