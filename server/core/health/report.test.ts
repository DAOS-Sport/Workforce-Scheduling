import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { assembleReport, INTEGRATIONS, SCHEDULED_JOBS, type HealthSignals } from "./report";
import { taipeiInstant } from "../time/taipei";
import type { HealthReport, Level } from "./types";

// 跟監控中樞 D:\工作內容\駿斯\tools\health-hub\contract\health-v1.example.json 同一份（比對 sha256）。
const EXAMPLE_PATH = path.join(__dirname, "health-v1.example.json");
const EXAMPLE_SHA256_PREFIX = "39192e13f6656e15";

const LEVELS: Level[] = ["green", "yellow", "red"];
const RANK: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

/** health-v1 格式檢查，規則與中樞的解析器相同。 */
function contractProblems(report: HealthReport): string[] {
  const problems: string[] = [];
  for (const key of ["system", "build", "checkedAt"] as const) if (typeof report[key] !== "string" || !report[key]) problems.push(`${key} missing`);
  if (Number.isNaN(Date.parse(report.checkedAt))) problems.push("checkedAt not a date");
  if (!LEVELS.includes(report.overall)) problems.push("overall not a level");
  if (!Array.isArray(report.pipelines) || report.pipelines.length === 0) problems.push("pipelines empty");
  const ids = new Set<string>();
  for (const p of report.pipelines) {
    if (!p.id || ids.has(p.id)) problems.push(`bad or duplicate id ${p.id}`);
    ids.add(p.id);
    if (!LEVELS.includes(p.level)) problems.push(`${p.id} level`);
    if (typeof p.name !== "string" || typeof p.reason !== "string" || !p.reason) problems.push(`${p.id} name/reason`);
  }
  const computed = report.pipelines.reduce<Level>((acc, p) => (RANK[p.level] > RANK[acc] ? p.level : acc), "green");
  if (computed !== report.overall) problems.push(`overall ${report.overall} != worst ${computed}`);
  return problems;
}

const NOW = taipeiInstant("2026-10-21", 20 * 60);
const recent = new Date(NOW.getTime() - 10 * 60_000).toISOString();

function healthySignals(): HealthSignals {
  const done = { lastStartedAt: recent, lastFinishedAt: recent, lastStatus: "success" as const, lastSuccessAt: recent };
  return {
    now: NOW,
    build: "test",
    schedulerActive: true,
    flags: Object.fromEntries(SCHEDULED_JOBS.map((j) => [j.flag, true])),
    jobs: Object.fromEntries(["ragic.sync", "ragic.webhook", "ragic.venue-sync", ...SCHEDULED_JOBS.map((j) => j.id)].map((id) => [id, done])),
    integrations: Object.fromEntries(INTEGRATIONS.map((i) => [i.key, { lastSuccessAt: recent, consecutiveFailures: 0 }])) as HealthSignals["integrations"],
    coverage: { startedShifts: 10, coveredShifts: 10, attemptsToday: 10, failuresToday: 0 },
    database: { latencyMs: 12 },
    holidayLastDate: "2027-12-31",
    security: { mcpTokenSet: true, mcpTokenDistinct: true, sessionSecretSet: true, lineChannelSecretSet: true },
  };
}

describe("health-v1 contract", () => {
  it("the example shared with the hub is byte-identical and valid", () => {
    const text = fs.readFileSync(EXAMPLE_PATH, "utf8");
    expect(crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)).toBe(EXAMPLE_SHA256_PREFIX);
    expect(contractProblems(JSON.parse(text))).toEqual([]);
  });

  it("a healthy system reports every pipeline green", () => {
    const report = assembleReport(healthySignals());
    expect(contractProblems(report)).toEqual([]);
    expect(report.overall).toBe("green");
    expect(report.pipelines.filter((p) => p.level !== "green").map((p) => `${p.id}: ${p.reason}`)).toEqual([]);
    expect(report.pipelines).toHaveLength(3 + 1 + SCHEDULED_JOBS.length + INTEGRATIONS.length + 3);
  });

  it("the manual Ragic venue sync is in the report, and a failed run only turns it yellow", () => {
    expect(assembleReport(healthySignals()).pipelines.map((p) => p.id)).toContain("ragic.venue-sync");
    const s = healthySignals();
    s.jobs["ragic.venue-sync"] = { lastStartedAt: recent, lastStatus: "failed", lastFailureAt: recent, lastError: "HTTP 500" };
    const venue = assembleReport(s).pipelines.find((p) => p.id === "ragic.venue-sync")!;
    expect([venue.level, venue.reason.includes("HTTP 500")]).toEqual(["yellow", true]);
  });

  it("an expired holiday table turns only that pipeline red", () => {
    const report = assembleReport({ ...healthySignals(), holidayLastDate: "2026-10-10" });
    expect(contractProblems(report)).toEqual([]);
    expect(report.pipelines.filter((p) => p.level === "red").map((p) => p.id)).toEqual(["holiday-table"]);
    expect(report.overall).toBe("red");
  });

  it("an unreadable signal is red for that pipeline only, the report still builds", () => {
    const s = healthySignals();
    s.jobs["push.missing-clock"] = { readError: "connection refused" };
    s.coverage = { readError: "timeout" };
    const report = assembleReport(s);
    expect(contractProblems(report)).toEqual([]);
    expect(report.pipelines.filter((p) => p.level === "red").map((p) => p.id).sort()).toEqual(["clock.coverage", "push.missing-clock"]);
  });
});
