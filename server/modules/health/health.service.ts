/**
 * 收集健康訊號（資料庫、狀態紀錄、環境變數），交給 core/health/report.ts 組成報告。
 * 任何一個訊號讀不到都只影響那一條管線，不讓整份報告失敗。
 */
import { sql } from "drizzle-orm";
import { performance } from "perf_hooks";
import { db } from "../../infra/db";
import { featureFlags } from "../../config/featureFlags";
import { IS_PRODUCTION } from "../../config/env";
import { LEAVE_TYPES } from "../shift/shift.types";
import { lastHolidayDate } from "../../core/calendar/taiwanHolidays";
import { taipeiClock } from "../../core/time/taipei";
import { assembleReport, INTEGRATIONS, MANUAL_JOBS, SCHEDULED_JOBS, type HealthSignals, type ReadError } from "../../core/health/report";
import type { ClockCoverage, PushDelivery } from "../../core/health/rules";
import type { HealthReport } from "../../core/health/types";
import { readIntegrationState, readJobState } from "../../shared/health/healthState";

async function attempt<T>(read: () => Promise<T>): Promise<T | ReadError> {
  try {
    return await read();
  } catch (err: any) {
    return { readError: String(err?.message ?? err).slice(0, 200) };
  }
}

async function readClockCoverage(now: Date): Promise<ClockCoverage> {
  const { date, minutes } = taipeiClock(now);
  const cutoff = Math.max(minutes - 30, -1);
  const cutoffTime = cutoff < 0 ? "00:00:00" : `${String(Math.floor(cutoff / 60)).padStart(2, "0")}:${String(cutoff % 60).padStart(2, "0")}:00`;
  const leave = sql.join(LEAVE_TYPES.map((t) => sql`${t}`), sql`, `);
  const result: any = await db.execute(sql`
    with started as (
      select s.employee_id from shifts s
      where s.date = ${date}::date and s.status = 'active' and coalesce(s.is_dispatch, false) = false
        and s.role not in (${leave}) and s.start_time <= ${cutoffTime}::time and ${cutoff} >= 0
    ), clocked as (
      select distinct c.employee_id from clock_records c
      where c.clock_type = 'in' and c.status in ('success', 'warning')
        and (c.clock_time + interval '8 hours')::date = ${date}::date
    ), today as (
      select c.status from clock_records c where (c.clock_time + interval '8 hours')::date = ${date}::date
    )
    select
      (select count(*) from started)::int as started,
      (select count(*) from started where employee_id in (select employee_id from clocked))::int as covered,
      (select count(*) from today)::int as attempts,
      (select count(*) from today where status = 'fail')::int as failures
  `);
  const row = result.rows[0];
  return { startedShifts: row.started, coveredShifts: row.covered, attemptsToday: row.attempts, failuresToday: row.failures };
}

async function probeDatabase(): Promise<{ latencyMs: number | null; error?: string }> {
  const t0 = performance.now();
  try {
    await db.execute(sql`select 1`);
    return { latencyMs: Math.round(performance.now() - t0) };
  } catch (err: any) {
    return { latencyMs: null, error: String(err?.message ?? err).slice(0, 200) };
  }
}

export async function collectSignals(now: Date): Promise<HealthSignals> {
  const jobIds = ["ragic.sync", "ragic.webhook", ...MANUAL_JOBS.map((j) => j.id), ...SCHEDULED_JOBS.map((j) => j.id)];
  const jobs = Object.fromEntries(await Promise.all(jobIds.map(async (id) => [id, await attempt(() => readJobState(id))] as const)));
  const integrations = Object.fromEntries(
    await Promise.all(INTEGRATIONS.map(async (i) => [i.key, await attempt(() => readIntegrationState(i.key))] as const)),
  ) as HealthSignals["integrations"];
  const mcpToken = process.env.MCP_TOKEN ?? "";
  return {
    now,
    build: process.env.HEALTH_BUILD_LABEL || "unknown",
    schedulerActive: IS_PRODUCTION,
    flags: { ...featureFlags },
    jobs,
    integrations,
    coverage: await attempt(() => readClockCoverage(now)),
    pushDelivery: await attempt(() => readPushDelivery()),
    database: await probeDatabase(),
    holidayLastDate: lastHolidayDate(),
    security: {
      mcpTokenSet: mcpToken.length > 0,
      mcpTokenDistinct: mcpToken.length > 0 && mcpToken !== (process.env.INTERNAL_API_TOKEN ?? ""),
      sessionSecretSet: !!process.env.SESSION_SECRET,
      lineChannelSecretSet: !!process.env.LINE_CHANNEL_SECRET,
    },
  };
}

export async function buildHealthReport(now: Date): Promise<HealthReport> {
  return assembleReport(await collectSignals(now));
}

async function readPushDelivery(): Promise<PushDelivery> {
  const result = await db.execute(sql`
    select count(*)::int as "pendingCount",
      count(*) filter (where updated_at >= (now() at time zone 'UTC') - interval '24 hours')::int as "recentPendingCount",
      to_char(min(updated_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "oldestPendingAt"
    from push_dedup
    where status = 'pending'
      and updated_at >= (now() at time zone 'UTC') - interval '7 days'
      and updated_at < (now() at time zone 'UTC') - interval '10 minutes'
  `);
  const row = result.rows[0];
  return { pendingCount: row.pendingCount as number, recentPendingCount: row.recentPendingCount as number, oldestPendingAt: row.oldestPendingAt as string | null };
}
