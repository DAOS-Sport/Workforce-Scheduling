import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute, readJobState, readIntegrationState } = vi.hoisted(() => ({
  execute: vi.fn(),
  readJobState: vi.fn(),
  readIntegrationState: vi.fn(),
}));
vi.mock("../../infra/db", () => ({ db: { execute } }));
vi.mock("../../config/env", () => ({ IS_PRODUCTION: true }));
vi.mock("../../config/featureFlags", () => ({ featureFlags: {} }));
vi.mock("../../shared/health/healthState", () => ({ readJobState, readIntegrationState }));

import { collectSignals, buildHealthReport } from "./health.service";

const now = new Date("2026-11-11T12:00:00.000Z");
const recent = new Date(now.getTime() - 60_000).toISOString();
const dialect = new PgDialect();
const delivery = { pendingCount: 2, oldestPendingAt: "2026-11-11T10:00:00.000Z" };

beforeEach(() => {
  vi.stubEnv("MCP_TOKEN", "health-test-mcp");
  vi.stubEnv("INTERNAL_API_TOKEN", "health-test-internal");
  vi.stubEnv("SESSION_SECRET", "health-test-session");
  vi.stubEnv("LINE_CHANNEL_SECRET", "health-test-line");
  readJobState.mockResolvedValue({ lastStartedAt: recent, lastSuccessAt: recent, lastStatus: "success" });
  readIntegrationState.mockResolvedValue({ lastSuccessAt: recent, consecutiveFailures: 0 });
  execute.mockImplementation(async (query) => {
    const text = dialect.sqlToQuery(query).sql;
    if (text.includes("push_dedup")) return { rows: [delivery] };
    if (text.includes("clock_records")) return { rows: [{ started: 1, covered: 1, attempts: 1, failures: 0 }] };
    return { rows: [{ "?column?": 1 }] };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("push delivery health collection", () => {
  it("collects the pending aggregate and includes it in the report", async () => {
    const signals = await collectSignals(now);
    expect(signals.pushDelivery).toEqual(delivery);
    const report = await buildHealthReport(now);
    expect(report.pipelines.find((p) => p.id === "push.delivery")).toMatchObject({ level: "yellow" });
    expect(report.pipelines.filter((p) => p.level !== "green").map((p) => p.id)).toEqual(["push.delivery"]);
  });

  it("keeps all other signals usable when the pending aggregate cannot be read", async () => {
    const original = execute.getMockImplementation()!;
    execute.mockImplementation(async (query) => {
      if (dialect.sqlToQuery(query).sql.includes("push_dedup")) throw new Error("pending query failed");
      return original(query);
    });

    const signals = await collectSignals(now);
    expect(signals.pushDelivery).toEqual({ readError: "pending query failed" });
    expect(signals.database.latencyMs).not.toBeNull();
    const report = await buildHealthReport(now);
    expect(report.pipelines.filter((p) => p.level === "red").map((p) => p.id)).toEqual(["push.delivery"]);
  });
});
