import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { pool as setupPool } from "../../infra/db";
import { assertLocalDatabaseUrl } from "../../test/itest";

it("writes and reads pipeline logs while an incompatible legacy table remains unchanged", async () => {
  const connection = new URL(assertLocalDatabaseUrl(process.env.DATABASE_URL));
  await setupPool.query("create schema pipeline_log_collision");
  await setupPool.query(`create table pipeline_log_collision.app_logs (
    id serial primary key, timestamp timestamp default now(), level text,
    service text not null, environment text not null, module text, action text,
    request_id text, route text, method text, status_code integer, duration_ms integer,
    error_code text, error_message text, external_service text, safe_context jsonb,
    message text not null
  );
  create index app_logs_timestamp_idx on pipeline_log_collision.app_logs (timestamp);
  create index app_logs_level_idx on pipeline_log_collision.app_logs (level);
  create index app_logs_request_id_idx on pipeline_log_collision.app_logs (request_id)`);
  const legacyColumns = () => setupPool.query(`select column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema = 'pipeline_log_collision' and table_name = 'app_logs'
    order by ordinal_position`);
  const before = (await legacyColumns()).rows;

  // Use the real DB module with an isolated search path; no query or repository is mocked.
  connection.searchParams.set("options", "-csearch_path=pipeline_log_collision,public");
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", connection.toString());
  const isolated = await import("../../infra/db");
  try {
    const migration = fs.readFileSync(path.resolve("docs/sql/20261111-app-logs.sql"), "utf8");
    await isolated.pool.query(migration);
    const { writeLogBatch } = await import("../../infra/logs");
    const { queryHealthLogs, attachPipelineLogs } = await import("../../modules/health/healthLogs");
    const { readFlowSignals } = await import("../../modules/health/flowSignals.repository");
    const now = new Date("2026-11-11T12:00:00Z");
    await writeLogBatch([
      { occurredAt: now, level: "warn", pipeline: "portal.login", requestId: null, message: "fixture warning" },
      { occurredAt: now, level: "warn", pipeline: "admin.login", requestId: null, message: "fixture warning" },
      { occurredAt: now, level: "error", pipeline: "manual.weekly-attendance", requestId: null, message: "fixture failure" },
      { occurredAt: now, level: "error", pipeline: "scheduler.catch-up", requestId: null, message: "fixture failure" },
      { occurredAt: now, level: "info", pipeline: "server.restarts", requestId: null, message: "server.started" },
    ]);

    expect((await isolated.pool.query("select count(*)::int as count from pipeline_logs")).rows[0].count).toBe(5);
    expect((await queryHealthLogs()).logs).toHaveLength(5);
    const attached = await attachPipelineLogs({ pipelines: [{ id: "portal.login" }] }, now);
    expect(attached.pipelines[0].logs).toEqual([expect.objectContaining({ pipeline: "portal.login", message: "fixture warning" })]);
    expect(attached.pipelines[0].logsError).toBeUndefined();
    const signals = await readFlowSignals(now);
    expect(signals.logins["portal.login"]).toMatchObject({ recent: 1, day: 1 });
    expect(signals.logins["admin.login"]).toMatchObject({ recent: 1, day: 1 });
    expect(signals.weeklyAttendanceErrors).toMatchObject({ recent: 1, day: 1 });
    expect(signals.catchUp).toMatchObject({ recent: 1, day: 1 });
    expect(signals.restarts).toBe(1);
    const indexes = await isolated.pool.query("select indexname from pg_indexes where schemaname = 'pipeline_log_collision' and tablename = 'pipeline_logs'");
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining(["pipeline_logs_pipeline_time_idx", "pipeline_logs_time_idx"]));
    expect((await setupPool.query("select count(*)::int as count from pipeline_log_collision.app_logs")).rows[0].count).toBe(0);
    expect((await legacyColumns()).rows).toEqual(before);
  } finally {
    await isolated.pool.end();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});
