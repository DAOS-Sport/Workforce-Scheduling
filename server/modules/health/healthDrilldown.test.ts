import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthSignals } from "../../core/health/report";
import type { HealthReport, Pipeline } from "../../core/health/types";
const { readErrors } = vi.hoisted(() => ({ readErrors: vi.fn(async () => []) }));
vi.mock("./healthDrilldown.repository", () => ({ readDrilldownErrors: readErrors }));
import { attachPipelineDrilldown } from "./healthDrilldown";

const NOW = new Date("2026-11-12T04:00:00Z");
const signals = () => ({ now: NOW, jobs: {}, integrations: {}, scheduleSave: {} }) as HealthSignals;
const pipe = (id: string, level: Pipeline["level"] = "red", extra: Partial<Pipeline> = {}): Pipeline =>
  ({ id, level, name: id, reason: "fixture", source: null, lastFailureAt: null, lastSuccessAt: null, ...extra });
const report = (...pipelines: Pipeline[]): HealthReport =>
  ({ system: "workforce-scheduling", build: "fixture", checkedAt: NOW.toISOString(), overall: "red", pipelines });
const log = (at: string, requestId: string | null = null) =>
  ({ id: 1, at, level: "warn" as const, pipeline: "portal.login", requestId, message: "虛構姓名 0912345678 fake@example.invalid" });

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); readErrors.mockResolvedValue([]); });

describe("optional drilldown metadata", () => {
  it("uses app_errors HTTP metadata for route pipelines and retains their logs separately", async () => {
    readErrors.mockResolvedValue([{ id: 1, occurredAt: new Date(NOW.getTime() - 1000), requestId: "route-request", method: "PATCH", path: "/api/employees/123", status: 500 }] as never);
    const app = express();
    app.patch("/api/employees/:id", (_req, res) => res.sendStatus(204));
    const logs = [{ ...log(NOW.toISOString(), "route-request"), pipeline: "employee.manage" }];
    const result = await attachPipelineDrilldown(report(pipe("employee.manage", "red", { logs })), signals(), app);
    expect(result.pipelines[0].logs).toEqual(logs);
    expect(result.pipelines[0].evidence).toEqual([{ at: "2026-11-12T03:59:59.000Z", requestId: "route-request", code: "500", route: "PATCH /api/employees/:id", summary: "伺服器錯誤 500" }]);
  });

  it.each([["A".repeat(64), "A".repeat(64)], ["request-01", "request-01"], ["A".repeat(65), null], ["bad_id", null], ["bad.id", null], ["", null], [null, null]])
  ("validates the exact requestId alphabet and length: %s", async (input, expected) => {
    const result = await attachPipelineDrilldown(report(pipe("portal.login", "yellow", { logs: [log(NOW.toISOString(), input)] })), signals());
    expect(result.pipelines[0].evidence?.[0].requestId).toBe(expected);
    expect(result.pipelines[0].evidence?.[0].summary).toBe("管線警告");
  });

  it("caps merged error/log evidence at five newest items and uses the shared route formatter", async () => {
    const app = express();
    app.patch("/api/portal/verify/:id", (_req, res) => res.sendStatus(204));
    readErrors.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: i, occurredAt: new Date(NOW.getTime() - (i + 1) * 1000),
      requestId: `error-${i}`, method: "PATCH", path: "/api/portal/verify/123?name=private", status: 500 })) as never);
    const result = await attachPipelineDrilldown(report(pipe("portal.login", "red", { logs: [log(NOW.toISOString(), "newest-log")] })), signals(), app);
    const evidence = result.pipelines[0].evidence!;
    expect(evidence).toHaveLength(5);
    expect(evidence.map(e => e.requestId)).toEqual(["newest-log", "error-0", "error-1", "error-2", "error-3"]);
    expect(evidence[1]).toMatchObject({ route: "PATCH /api/portal/verify/:id", summary: "伺服器錯誤 500" });
  });

  it("omits evidence for green pipelines, even when old warnings remain in logs", async () => {
    const p = pipe("portal.login", "green", { logs: [log(NOW.toISOString())] });
    const result = await attachPipelineDrilldown(report(p), signals());
    expect(result.pipelines[0].evidence).toBeUndefined();
    expect(result.pipelines[0].logs).toEqual(p.logs);
    expect(readErrors).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "http://workforce.example.invalid", "invalid", "https://user:password@workforce.example.invalid"])
  ("omits links without an eligible configured public origin: %s", async value => {
    vi.stubEnv("HEALTH_PUBLIC_URL", value);
    expect((await attachPipelineDrilldown(report(pipe("database")), signals())).pipelines[0].links).toBeUndefined();
  });

  it("links every pipeline, including green ones, to its own card without configured query values", async () => {
    vi.stubEnv("HEALTH_PUBLIC_URL", "https://workforce.example.invalid/old?token=fixture#ignored");
    const result = await attachPipelineDrilldown(report(pipe("database", "green"), pipe("portal.login", "red")), signals());
    expect(result.pipelines.map(p => p.links)).toEqual([
      [{ label: "後台 IT 監控", url: "https://workforce.example.invalid/it-monitor#database" }],
      [{ label: "後台 IT 監控", url: "https://workforce.example.invalid/it-monitor#portal.login" }],
    ]);
  });

  it("keeps the report and existing logs usable when optional error metadata cannot be read", async () => {
    readErrors.mockRejectedValue(new Error("private database detail"));
    const p = pipe("portal.login", "yellow", { logs: [log(NOW.toISOString())] });
    const result = await attachPipelineDrilldown(report(p), signals());
    expect(result.pipelines[0]).toMatchObject({ level: p.level, reason: p.reason, logs: p.logs });
    expect(result.pipelines[0].evidence).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });

  it("converts only real failure timestamps from existing job/integration/save signals", async () => {
    const s = signals();
    s.jobs = { "ragic.sync": { lastFailureAt: "2026-11-12T03:00:00Z", lastError: "虛構個資" }, "ragic.venue-sync": { readError: "private" } };
    s.integrations = { line: { lastFailureAt: "2026-11-12T02:00:00Z", lastError: "private" } } as HealthSignals["integrations"];
    s.scheduleSave = { lastCriticalAt: "2026-11-12T01:00:00Z" };
    const result = await attachPipelineDrilldown(report(pipe("ragic.employee-sync"), pipe("ragic.venue-sync"), pipe("integration.line"), pipe("schedule.save"), pipe("clock.never-success")), s);
    expect(result.pipelines.map(p => p.evidence?.[0].summary)).toEqual(["排程執行失敗", undefined, "外部服務呼叫失敗", "排班儲存失敗", undefined]);
    expect(JSON.stringify(result)).not.toMatch(/虛構個資|private/);
  });

  it("correlates existing geolocation warnings with the geolocation pipeline", async () => {
    const entry = { ...log(NOW.toISOString(), "geo-request"), pipeline: "clock.coverage", message: 'geolocation_failure {"kind":"TIMEOUT"}' };
    const result = await attachPipelineDrilldown(report(pipe("clock.coverage", "green", { logs: [entry] }), pipe("clock.geolocation", "yellow")), signals());
    expect(result.pipelines[0].evidence).toBeUndefined();
    expect(result.pipelines[1].evidence).toEqual([{ at: NOW.toISOString(), requestId: "geo-request", code: null, route: null, summary: "定位失敗" }]);
  });

  it("uses the existing LINE event failure timestamp without fabricating a request ID", async () => {
    const s = signals();
    s.flow = { lineWebhook: { recent: 1, day: 1, lastFailureAt: "2026-11-12T03:00:00Z" } } as HealthSignals["flow"];
    const result = await attachPipelineDrilldown(report(pipe("line.webhook")), s);
    expect(result.pipelines[0].evidence).toEqual([{ at: "2026-11-12T03:00:00.000Z", requestId: null, code: null, route: null, summary: "LINE webhook 處理失敗" }]);
  });
});
