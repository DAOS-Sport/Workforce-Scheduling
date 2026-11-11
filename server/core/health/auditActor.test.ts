import { describe, expect, it } from "vitest";
import { assembleReport, INTEGRATIONS, SCHEDULED_JOBS, type HealthSignals } from "./report";

const now = new Date("2026-11-11T06:00:00Z");
const recent = now.toISOString();
const good = {
  sharedPasswordEnabled: true,
  sharedWrites24h: 0,
  disabledSharedWrites24h: 0,
  missingAudits24h: 0,
  failures24h: 0,
  witnessAvailable: true,
};
function signals(auditActor: unknown): HealthSignals {
  const done = { lastStartedAt: recent, lastFinishedAt: recent, lastStatus: "success", lastSuccessAt: recent };
  return {
    now, build: "test", schedulerActive: true, flags: {},
    jobs: Object.fromEntries(["ragic.sync", "ragic.webhook", "ragic.venue-sync", ...SCHEDULED_JOBS.map(j => j.id)].map(id => [id, done])),
    integrations: Object.fromEntries(INTEGRATIONS.map(i => [i.key, { lastSuccessAt: recent, consecutiveFailures: 0 }])),
    coverage: { startedShifts: 0, coveredShifts: 0, attemptsToday: 0, failuresToday: 0 },
    database: { latencyMs: 1 }, holidayLastDate: "2027-12-31",
    security: { mcpTokenSet: true, mcpTokenDistinct: true, sessionSecretSet: true, lineChannelSecretSet: true },
    auditActor,
  } as HealthSignals;
}
const audit = (input: unknown) => assembleReport(signals(input)).pipelines.find(p => p.id === "audit.actor");

describe("audit.actor", () => {
  it("reports green when writes are attributable and none used the shared password", () => {
    expect(audit(good)).toMatchObject({ id: "audit.actor", name: "操作紀錄", level: "green" });
  });
  it("reports yellow and the actual count while shared-password writes remain enabled", () => {
    expect(audit({ ...good, sharedWrites24h: 3 })).toMatchObject({ level: "yellow", reason: expect.stringContaining("3") });
  });
  it.each([
    { ...good, missingAudits24h: 1 },
    { ...good, failures24h: 1 },
    { ...good, failures24h: 1, witnessAvailable: false },
    { ...good, sharedPasswordEnabled: false, disabledSharedWrites24h: 1 },
    { ...good, sharedPasswordEnabled: true, disabledSharedWrites24h: 1 },
  ])("reports red for a committed audit gap, failed audit, or prohibited shared write: %j", input => {
    expect(audit(input)).toMatchObject({ level: "red" });
  });
  it("does not treat permitted writes before the switch was disabled as prohibited writes", () => {
    expect(audit({ ...good, sharedPasswordEnabled: false, sharedWrites24h: 3 })).toMatchObject({ level: "green" });
  });
  it("reports yellow when independent mutation evidence cannot be observed", () => {
    expect(audit({ ...good, witnessAvailable: false })).toMatchObject({ level: "yellow", reason: expect.stringContaining("無法觀測") });
  });
  it("isolates a database read failure to this pipeline", () => {
    const report = assembleReport(signals({ readError: "read failed" }));
    expect(report.pipelines.filter(p => p.level === "red").map(p => p.id)).toEqual(["audit.actor"]);
  });
});
