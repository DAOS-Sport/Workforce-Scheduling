import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../infra/db", () => ({ db: { execute } }));
vi.mock("../../config/env", () => ({ IS_PRODUCTION: false }));
vi.mock("../../shared/health/healthState", () => ({ readJobState: vi.fn(async () => undefined), readIntegrationState: vi.fn(async () => undefined) }));
import { buildHealthReport, collectSignals } from "./health.service";

const now = new Date("2026-11-11T04:00:00Z");
const queryOf = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(q);

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (query) => {
    const text = queryOf(query).sql;
    if (text.includes("app_errors")) return { rows: [{ last_critical_at: null, last_unsaved_exit_at: null }] };
    return { rows: [{ started: 0, covered: 0, attempts: 0, failures: 0 }] };
  });
});

describe("schedule save signal collection", () => {
  it("adds one read-only app_errors query for browser events and the exact save POST 5xx", async () => {
    const signals = await collectSignals(now);
    const queries = execute.mock.calls.map(([q]) => queryOf(q));
    const query = queries.find((q) => q.sql.includes("app_errors"));
    expect(signals.scheduleSave).toEqual({});
    expect(query).toBeDefined();
    expect(query!.sql).toContain("method = 'POST'");
    expect(query!.sql).toContain("status between 500 and 599");
    expect(query!.params).toContain("/api/admin/schedule-assignments");
    expect(query!.sql.trim()).toMatch(/^select/i);
  });

  it("an unreadable app_errors signal makes only schedule.save red", async () => {
    execute.mockImplementation(async (query) => {
      if (queryOf(query).sql.includes("app_errors")) throw new Error("schedule signal unavailable");
      return { rows: [{ started: 0, covered: 0, attempts: 0, failures: 0 }] };
    });
    const report = await buildHealthReport(now);
    const p = report.pipelines.find((item) => item.id === "schedule.save");
    expect(p).toMatchObject({ level: "red", reason: "讀取狀態失敗：schedule signal unavailable" });
    expect(report.pipelines.filter((item) => item.id !== "schedule.save").some((item) => item.reason.includes("schedule signal unavailable"))).toBe(false);
    expect(report.pipelines.find((item) => item.id === "database")!.level).toBe("green");
  });
});
