import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute, readJobState, readIntegrationState } = vi.hoisted(() => ({ execute: vi.fn(), readJobState: vi.fn(), readIntegrationState: vi.fn() }));
vi.mock("../../infra/db", () => ({ db: { execute } }));
vi.mock("../../config/env", () => ({ IS_PRODUCTION: false }));
vi.mock("../../config/featureFlags", () => ({ featureFlags: {} }));
vi.mock("../../shared/health/healthState", () => ({ readJobState, readIntegrationState }));
vi.mock("./flowSignals", () => ({ collectFlowSignals: vi.fn(async () => undefined) }));
import { collectSignals } from "./health.service";
import { assembleReport } from "../../core/health/report";

const now = new Date("2026-11-11T04:00:00.000Z");
const dialect = new PgDialect();
let aggregate: { recentFailures: number; failures24h: number; lastFailureAt: string | null };

beforeEach(() => {
  aggregate = { recentFailures: 3, failures24h: 5, lastFailureAt: "2026-11-11T03:59:00.000Z" };
  readJobState.mockResolvedValue(undefined);
  readIntegrationState.mockResolvedValue(undefined);
  execute.mockImplementation(async query => {
    const text = dialect.sqlToQuery(query).sql;
    if (text.includes('as "recentFailures"')) return { rows: [aggregate] };
    if (text.includes("with snapshots")) return { rows: [{ affectedEmployees: 0, newlyQualifiedEmployees: 0 }] };
    if (text.includes("push_dedup")) return { rows: [{ pendingCount: 0, recentPendingCount: 0, oldestPendingAt: null }] };
    if (text.includes("clock_records")) return { rows: [{ started: 0, covered: 0, attempts: 0, failures: 0 }] };
    if (text.includes("audit_mutations")) return { rows: [{ enabled: false, shared_writes: 0, disabled_writes: 0, missing_audits: 0, failures: 0, witness_available: true }] };
    return { rows: [{}] };
  });
});
afterEach(() => vi.resetAllMocks());

describe("geolocation health collection", () => {
  it("collects the independent aggregate and uses only read statements", async () => {
    const input = await collectSignals(now);
    expect(input.geolocation).toEqual(aggregate);
    expect(assembleReport(input).pipelines.find(p => p.id === "clock.geolocation")).toMatchObject({ level: "red" });
    expect(execute.mock.calls.map(([query]) => dialect.sqlToQuery(query).sql).some(text => /\b(insert|update|delete)\b/i.test(text))).toBe(false);
  });

  it("wraps read failure in ReadError while keeping other signals usable", async () => {
    const original = execute.getMockImplementation()!;
    execute.mockImplementation(async query => {
      if (dialect.sqlToQuery(query).sql.includes('as "recentFailures"')) throw new Error("synthetic private query detail");
      return original(query);
    });
    const input = await collectSignals(now);
    expect(input.geolocation).toEqual({ readError: "synthetic private query detail" });
    expect(input.coverage).toEqual({ startedShifts: 0, coveredShifts: 0, attemptsToday: 0, failuresToday: 0 });
    expect(input.database.latencyMs).not.toBeNull();
    const pipeline = assembleReport(input).pipelines.find(p => p.id === "clock.geolocation");
    expect(pipeline).toMatchObject({ level: "red" });
    expect(pipeline?.reason).not.toContain("synthetic private query detail");
  });
});
