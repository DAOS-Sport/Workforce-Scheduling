import { describe, expect, it } from "vitest";
import { evaluateClockGeolocation } from "./rules";
import { assembleReport, INTEGRATIONS, SCHEDULED_JOBS, type HealthSignals } from "./report";

const base = { id: "clock.geolocation", name: "打卡定位", source: "pipeline_logs" };
const lastFailureAt = "2026-11-11T03:59:00.000Z";
const healthy = { recentFailures: 0, failures24h: 0, lastFailureAt: null };

describe("clock.geolocation", () => {
  it("is red at three failures in 15 minutes and describes attempts rather than people", () => {
    const result = evaluateClockGeolocation({ ...base, signals: { recentFailures: 3, failures24h: 5, lastFailureAt } });
    expect(result).toMatchObject({ level: "red", lastFailureAt });
    expect(result.reason).toContain("15 分鐘");
    expect(result.reason).toContain("3 次");
    expect(result.reason).not.toMatch(/人|員工|employee/i);
  });

  it.each([1, 2])("is yellow for %i transient recent failures", recentFailures => {
    expect(evaluateClockGeolocation({ ...base, signals: { recentFailures, failures24h: recentFailures, lastFailureAt } })).toMatchObject({ level: "yellow", lastFailureAt });
  });

  it("is yellow when failures remain only in the older part of the 24-hour window", () => {
    expect(evaluateClockGeolocation({ ...base, signals: { recentFailures: 0, failures24h: 7, lastFailureAt } })).toMatchObject({ level: "yellow", reason: expect.stringContaining("7 次") });
  });

  it("is green when the observed 24-hour window has no failures", () => {
    expect(evaluateClockGeolocation({ ...base, signals: healthy })).toMatchObject({ level: "green", lastFailureAt: null });
  });

  it("is yellow when there is no observation signal", () => {
    expect(evaluateClockGeolocation(base)).toMatchObject({ level: "yellow", reason: expect.stringContaining("無法觀測") });
  });
});

function signals(): HealthSignals {
  const now = new Date("2026-11-11T04:00:00.000Z");
  const done = { lastStartedAt: now.toISOString(), lastSuccessAt: now.toISOString() };
  return {
    now, build: "test", schedulerActive: false, flags: Object.fromEntries(SCHEDULED_JOBS.map(job => [job.flag, false])),
    jobs: Object.fromEntries(["ragic.sync", "ragic.webhook", ...SCHEDULED_JOBS.map(job => job.id)].map(id => [id, done])),
    integrations: Object.fromEntries(INTEGRATIONS.map(integration => [integration.key, { lastSuccessAt: now.toISOString() }])) as HealthSignals["integrations"],
    coverage: { startedShifts: 0, coveredShifts: 0, attemptsToday: 0, failuresToday: 0 },
    pushDelivery: { pendingCount: 0, recentPendingCount: 0, oldestPendingAt: null },
    clockNeverSuccess: { affectedEmployees: 0, newlyQualifiedEmployees: 0 }, scheduleSave: {},
    auditActor: { sharedPasswordEnabled: false, sharedWrites24h: 0, disabledSharedWrites24h: 0, missingAudits24h: 0, failures24h: 0, witnessAvailable: true },
    database: { latencyMs: 1 }, holidayLastDate: "2027-12-31",
    security: { mcpTokenSet: true, mcpTokenDistinct: true, sessionSecretSet: true, lineChannelSecretSet: true },
    geolocation: healthy,
  };
}

describe("clock.geolocation report assembly", () => {
  it("adds exactly one independent pipeline and includes it in overall severity", () => {
    const input = signals();
    input.geolocation = { recentFailures: 3, failures24h: 3, lastFailureAt };
    const report = assembleReport(input);
    expect(report.pipelines.filter(p => p.id === base.id)).toHaveLength(1);
    expect(report.pipelines.filter(p => p.level !== "green").map(p => p.id)).toEqual([base.id]);
    expect(report.overall).toBe("red");
  });

  it("isolates an unreadable aggregate and does not disclose the query error", () => {
    const input = signals();
    input.geolocation = { readError: "synthetic private query detail" };
    const report = assembleReport(input);
    expect(report.pipelines.filter(p => p.level === "red").map(p => p.id)).toEqual([base.id]);
    expect(report.pipelines.find(p => p.id === base.id)?.reason).toBe("讀取狀態失敗：定位失敗訊號讀取失敗");
    expect(JSON.stringify(report)).not.toContain("synthetic private query detail");
  });
});
