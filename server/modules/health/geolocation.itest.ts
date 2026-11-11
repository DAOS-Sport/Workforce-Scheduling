import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appLogs } from "@shared/schema";
import { db } from "../../infra/db";
import { writeLogBatch } from "../../infra/logs";
import { resetDatabase } from "../../test/itest";
import { configureLogSink, flushLogs } from "../../shared/logging/collector";

vi.mock("../../config/env", () => ({ IS_PRODUCTION: false }));
vi.mock("../anomaly/anomaly.service", () => ({ anomalyService: { create: vi.fn(() => { throw new Error("telemetry must not create employee reports"); }) } }));
import { mountAnomalyRoutes } from "../anomaly/anomaly.routes";
import { collectSignals } from "./health.service";
import { assembleReport } from "../../core/health/report";

const now = new Date("2026-11-11T04:00:00.000Z");
const minute = 60_000;
const message = 'geolocation_failure {"kind":"TIMEOUT","entry":"liff","platform":"iOS","inLine":true}';
const row = (at: Date, overrides = {}) => ({ occurredAt: at, pipeline: "clock.coverage", level: "warn", message, ...overrides });

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

describe("geolocation failure watchdog PostgreSQL aggregate", () => {
  it("reports green for an observed empty failure window", async () => {
    const input = await collectSignals(now);
    expect(input.geolocation).toEqual({ recentFailures: 0, failures24h: 0, lastFailureAt: null });
    expect(assembleReport(input).pipelines.find(p => p.id === "clock.geolocation")?.level).toBe("green");
  });

  it("uses inclusive 15-minute and 24-hour UTC boundaries and ignores unrelated or future logs", async () => {
    await db.insert(appLogs).values([
      row(new Date(now.getTime() - 15 * minute)), row(new Date(now.getTime() - minute)), row(now),
      row(new Date(now.getTime() - 24 * 60 * minute)),
      row(new Date(now.getTime() - 24 * 60 * minute - 1)), row(new Date(now.getTime() + 1)),
      row(now, { pipeline: "anomaly.report" }), row(now, { level: "info" }),
      row(now, { message: "different geolocation_failure event" }), row(now, { message: "geolocation_failure_extra {}" }),
    ]);
    const before = await db.select().from(appLogs);
    const input = await collectSignals(now);
    expect(input.geolocation).toEqual({ recentFailures: 3, failures24h: 4, lastFailureAt: now.toISOString() });
    expect(assembleReport(input).pipelines.find(p => p.id === "clock.geolocation")).toMatchObject({ level: "yellow" });
    expect(await db.select().from(appLogs)).toEqual(before);
  });

  it("keeps older failures yellow and does not include the 15-minute-plus-1ms record in the recent count", async () => {
    const at = new Date(now.getTime() - 15 * minute - 1);
    await db.insert(appLogs).values([row(at), row(new Date(now.getTime() - 24 * 60 * minute))]);
    const input = await collectSignals(now);
    expect(input.geolocation).toEqual({ recentFailures: 0, failures24h: 2, lastFailureAt: at.toISOString() });
    expect(assembleReport(input).pipelines.find(p => p.id === "clock.geolocation")?.level).toBe("yellow");
  });

  it("persists each fallback-attempt failure with four metadata fields through the existing HTTP endpoint", async () => {
    const stop = configureLogSink(writeLogBatch);
    const app = express();
    app.use(express.json());
    mountAnomalyRoutes({} as Server, app);
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      for (const kind of ["TIMEOUT", "POSITION_UNAVAILABLE", "POOR_ACCURACY"]) {
        const response = await fetch(`http://127.0.0.1:${port}/api/anomaly-report`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "geolocation_failure", kind, entry: "portal", platform: "Android", inLine: false }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ received: true });
      }
      await flushLogs();
      const rows = await db.select().from(appLogs);
      expect(rows).toHaveLength(3);
      expect(rows.map(r => [r.level, r.pipeline, JSON.parse(r.message.slice("geolocation_failure ".length))])).toEqual(
        ["TIMEOUT", "POSITION_UNAVAILABLE", "POOR_ACCURACY"].map(kind => ["warn", "clock.coverage", { kind, entry: "portal", platform: "Android", inLine: false }]),
      );
      const input = await collectSignals(new Date());
      expect(input.geolocation).toMatchObject({ recentFailures: 3, failures24h: 3 });
      expect(assembleReport(input).pipelines.find(p => p.id === "clock.geolocation")?.level).toBe("yellow");
    } finally {
      await flushLogs();
      stop();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("isolates a failed aggregate read through attempt/ReadError without exposing query details", async () => {
    const execute = db.execute.bind(db);
    const dialect = new PgDialect();
    vi.spyOn(db, "execute").mockImplementation(((query: any) => {
      if (dialect.sqlToQuery(query).sql.includes('as "recentFailures"')) return Promise.reject(new Error("synthetic private query detail"));
      return execute(query);
    }) as typeof db.execute);
    const input = await collectSignals(now);
    expect(input.geolocation).toEqual({ readError: "synthetic private query detail" });
    const report = assembleReport(input);
    expect(report.pipelines.find(p => p.id === "clock.geolocation")).toMatchObject({ level: "yellow" });
    expect(report.pipelines.find(p => p.id === "clock.coverage")?.level).toBe("green");
    expect(JSON.stringify(report)).not.toContain("synthetic private query detail");
  });
});
