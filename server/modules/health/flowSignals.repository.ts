/** Only reads existing rows; failures stay confined to the signal that could not be read. */
import { pool } from "../../infra/db";
import { FLOW_DEFINITIONS, pipelineForPath, type FlowErrorWindow, type FlowSignal, type FlowSignals } from "../../core/health/flowRules";
import type { JobState } from "../../core/health/types";

const HOUR = 60 * 60_000;
const clear = (): FlowErrorWindow => ({ recent: 0, day: 0, lastFailureAt: null });
const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString();
const window = (r: { recent: string | number; day: string | number; last_failure_at: Date | string | null }): FlowErrorWindow =>
  ({ recent: Number(r.recent), day: Number(r.day), lastFailureAt: iso(r.last_failure_at) });

async function read<T>(name: string, action: () => Promise<T>): Promise<FlowSignal<T>> {
  try { return await action(); }
  catch { return { readError: `無法讀取${name}` }; }
}

async function readRequests(now: Date): Promise<FlowSignals["requests"]> {
  const requests: FlowSignals["requests"] = Object.fromEntries(FLOW_DEFINITIONS.map((d) => [d.id, clear()]));
  const result = await read("路由錯誤紀錄", () => pool.query(
    `select path, count(*) filter (where occurred_at >= $2::timestamptz) as recent,
            count(*) as day, max(occurred_at) as last_failure_at
       from app_errors
      where status >= 500 and status < 600 and occurred_at >= $1::timestamptz and occurred_at <= $3::timestamptz
      group by path`,
    [new Date(now.getTime() - 24 * HOUR).toISOString(), new Date(now.getTime() - HOUR).toISOString(), now.toISOString()],
  ));
  if ("readError" in result) return Object.fromEntries(FLOW_DEFINITIONS.map((d) => [d.id, result]));
  for (const row of result.rows) {
    const id = pipelineForPath(row.path);
    if (!id || !requests[id]) continue;
    const signal = requests[id] as FlowErrorWindow;
    const w = window(row);
    signal.recent += w.recent;
    signal.day += w.day;
    if (w.lastFailureAt && (!signal.lastFailureAt || w.lastFailureAt > signal.lastFailureAt)) signal.lastFailureAt = w.lastFailureAt;
  }
  return requests;
}

async function readLogErrors(pipeline: string, now: Date): Promise<FlowSignal<FlowErrorWindow>> {
  return read("工作流事件紀錄", async () => {
    const { rows } = await pool.query(
      `select count(*) filter (where occurred_at >= ($2::timestamptz at time zone 'UTC')) as recent,
              count(*) as day, max(occurred_at) at time zone 'UTC' as last_failure_at
         from pipeline_logs
        where pipeline = $4 and (level = 'error' or ($4 in ('portal.login', 'admin.login') and level = 'warn'))
          and occurred_at >= ($1::timestamptz at time zone 'UTC') and occurred_at <= ($3::timestamptz at time zone 'UTC')`,
      [new Date(now.getTime() - 24 * HOUR).toISOString(), new Date(now.getTime() - HOUR).toISOString(), now.toISOString(), pipeline],
    );
    return window(rows[0]);
  });
}

async function pending(table: string, name: string, now: Date): Promise<FlowSignal<number>> {
  return read(name, async () => {
    const { rows } = await pool.query(`select count(*) as count from ${table} where status = 'pending' and created_at < ($1::timestamptz at time zone 'UTC')`, [new Date(now.getTime() - 7 * 24 * HOUR).toISOString()]);
    return Number(rows[0].count);
  });
}

async function job(id: string): Promise<FlowSignal<JobState | undefined>> {
  return read("工作執行結果", async () => {
    const { rows } = await pool.query("select value from system_configs where key = $1", [`health:job:${id}`]);
    return rows[0] ? JSON.parse(rows[0].value) as JobState : undefined;
  });
}

export async function readFlowSignals(now: Date): Promise<Omit<FlowSignals, "schedulerActive">> {
  const day = new Date(now.getTime() - 24 * HOUR).toISOString();
  const hour = new Date(now.getTime() - HOUR).toISOString();
  const end = now.toISOString();
  const [requests, amendments, leave, overtime, serverErrors, restarts, lineWebhook, portalLogin, adminLogin, catchUp, purge, weeklyAttendance, weeklyAttendanceErrors] = await Promise.all([
    readRequests(now),
    pending("clock_amendments", "待審補打卡申請", now),
    pending("leave_requests", "待審請假申請", now),
    pending("overtime_requests", "待審加班申請", now),
    read("全站錯誤紀錄", async () => {
      const { rows } = await pool.query(
        `select count(*) filter (where occurred_at >= $2::timestamptz) as recent,
                count(*) as day, max(occurred_at) as last_failure_at
           from app_errors where status >= 500 and status < 600
            and occurred_at >= $1::timestamptz and occurred_at <= $3::timestamptz`,
        [day, new Date(now.getTime() - 15 * 60_000).toISOString(), end],
      );
      return window(rows[0]);
    }),
    read("啟動次數", async () => {
      const { rows } = await pool.query(
        `select count(*) as count from pipeline_logs where pipeline = 'server.restarts' and level = 'info' and message = 'server.started'
          and occurred_at >= ($1::timestamptz at time zone 'UTC') and occurred_at <= ($2::timestamptz at time zone 'UTC')`, [day, end]);
      return Number(rows[0].count);
    }),
    read("LINE webhook 事件", async () => {
      const { rows } = await pool.query(
        `select count(*) filter (where coalesce(processed_at, received_at) >= ($2::timestamptz at time zone 'UTC')) as recent,
                count(*) as day, max(coalesce(processed_at, received_at)) at time zone 'UTC' as last_failure_at
           from line_webhook_events where status = 'failed'
            and coalesce(processed_at, received_at) >= ($1::timestamptz at time zone 'UTC')
            and coalesce(processed_at, received_at) <= ($3::timestamptz at time zone 'UTC')`, [day, hour, end]);
      return window(rows[0]);
    }),
    readLogErrors("portal.login", now), readLogErrors("admin.login", now),
    read("排程補跑事件", async () => {
      const { rows } = await pool.query(
        `select count(*) filter (where level = 'error' and occurred_at >= ($2::timestamptz at time zone 'UTC')) as recent,
                count(*) filter (where level = 'error') as day,
                max(occurred_at) filter (where level = 'error') at time zone 'UTC' as last_failure_at,
                count(*) filter (where level = 'info' and message = 'catch-up.started') as attempts
           from pipeline_logs where pipeline = 'scheduler.catch-up'
            and occurred_at >= ($1::timestamptz at time zone 'UTC') and occurred_at <= ($3::timestamptz at time zone 'UTC')`, [day, hour, end]);
      return { ...window(rows[0]), attempts24h: Number(rows[0].attempts) };
    }),
    job("errors.purge"), job("manual.weekly-attendance"), readLogErrors("manual.weekly-attendance", now),
  ]);
  return { now, requests,
    pendingReviews: { "clock.amendment": amendments, "leave.request": leave, "overtime.request": overtime },
    serverErrors, restarts, lineWebhook, logins: { "portal.login": portalLogin, "admin.login": adminLogin }, catchUp, purge, weeklyAttendance, weeklyAttendanceErrors };
}
