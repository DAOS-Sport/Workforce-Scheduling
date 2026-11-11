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
import { addDays, taipeiClock } from "../../core/time/taipei";
import { assembleReport, INTEGRATIONS, MANUAL_JOBS, SCHEDULED_JOBS, type HealthSignals, type ReadError } from "../../core/health/report";
import type { ClockCoverage } from "../../core/health/rules";
import { CLOCK_NEVER_SUCCESS_LOOKBACK_DAYS, CLOCK_NEVER_SUCCESS_MIN_SHIFTS, CLOCK_NEVER_SUCCESS_NEW_HOURS, CLOCK_NEVER_SUCCESS_THRESHOLD_DAYS, type ClockNeverSuccess } from "../../core/health/rules";
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
    clockNeverSuccess: await attempt(() => readClockNeverSuccess(now)),
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

export type ClockNeverSuccessEmployee = {
  id: number;
  name: string;
  shiftCount7Days: number;
  shiftCount14Days: number;
  lastAttemptAt: string | null;
};

/** Both snapshots share one database statement; no alert state is stored. */
function clockNeverSuccessQuery(now: Date) {
  const previous = new Date(now.getTime() - CLOCK_NEVER_SUCCESS_NEW_HOURS * 60 * 60_000);
  const snapshot = (at: Date, current: boolean) => {
    const { date } = taipeiClock(at);
    return sql`(${current}::boolean, ${at.toISOString()}::timestamp, ${addDays(date, 1 - CLOCK_NEVER_SUCCESS_THRESHOLD_DAYS)}::date, ${addDays(date, 1 - CLOCK_NEVER_SUCCESS_LOOKBACK_DAYS)}::date)`;
  };
  const leave = sql.join(LEAVE_TYPES.map(t => sql`${t}`), sql`, `);
  return sql`
    with snapshots (is_current, at_utc, from7, from14) as (
      values ${snapshot(now, true)}, ${snapshot(previous, false)}
    ), shift_counts as (
      select sn.is_current, s.employee_id,
        count(*) filter (where s.date >= sn.from7)::int as shifts7,
        count(*)::int as shifts14
      from snapshots sn
      join shifts s on s.date >= sn.from14 and s.date + s.start_time <= sn.at_utc + interval '8 hours'
      join employees e on e.id = s.employee_id
      where e.status = 'active' and nullif(btrim(e.line_id), '') is not null
        and s.status = 'active' and coalesce(s.is_dispatch, false) = false and s.role not in (${leave})
      group by sn.is_current, s.employee_id
    ), clock_success as (
      select sn.is_current, c.employee_id,
        bool_or((c.clock_time + interval '8 hours')::date >= sn.from7) as has_success7
      from snapshots sn
      join clock_records c on c.clock_time <= sn.at_utc
        and (c.clock_time + interval '8 hours')::date >= sn.from14
      where c.clock_type = 'in' and c.status in ('success', 'warning')
      group by sn.is_current, c.employee_id
    ), never_success as (
      select cur.employee_id, cur.shifts7, cur.shifts14,
        cur.shifts7 >= ${CLOCK_NEVER_SUCCESS_MIN_SHIFTS} and not exists (
          select 1 from shift_counts prev
          left join clock_success ps on ps.is_current = prev.is_current and ps.employee_id = prev.employee_id
          where not prev.is_current and prev.employee_id = cur.employee_id
            and prev.shifts7 >= ${CLOCK_NEVER_SUCCESS_MIN_SHIFTS} and not coalesce(ps.has_success7, false)
        ) as newly_qualified
      from shift_counts cur
      left join clock_success cs on cs.is_current = cur.is_current and cs.employee_id = cur.employee_id
      where cur.is_current and cs.employee_id is null
    )
  `;
}

async function readClockNeverSuccess(now: Date): Promise<ClockNeverSuccess> {
  const result = await db.execute<{ affectedEmployees: number; newlyQualifiedEmployees: number }>(sql`
    ${clockNeverSuccessQuery(now)}
    select count(*)::int as "affectedEmployees",
      count(*) filter (where newly_qualified)::int as "newlyQualifiedEmployees" from never_success
  `);
  return result.rows[0];
}

/** Employee details are available only through the authenticated admin endpoint. */
export async function readClockNeverSuccessEmployees(now: Date): Promise<ClockNeverSuccessEmployee[]> {
  const result = await db.execute<ClockNeverSuccessEmployee>(sql`
    ${clockNeverSuccessQuery(now)}
    select e.id, e.name, ns.shifts7 as "shiftCount7Days", ns.shifts14 as "shiftCount14Days",
      (select to_char(max(c.clock_time), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from clock_records c
        where c.employee_id = ns.employee_id and c.clock_time <= ${now.toISOString()}::timestamp) as "lastAttemptAt"
    from never_success ns join employees e on e.id = ns.employee_id order by e.id
  `);
  return result.rows;
}
