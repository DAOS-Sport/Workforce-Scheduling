import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../infra/db";
import { resetDatabase } from "../../test/itest";
import { evaluateFlowPipelines } from "../../core/health/flowRules";
import { collectFlowSignals } from "./flowSignals";
import { buildHealthReport } from "./health.service";

const now = new Date("2026-11-11T04:00:00.000Z");
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
beforeEach(async () => { await resetDatabase(); });

async function error(path: string, minutesAgo: number, status = 500) {
  await pool.query("insert into app_errors(request_id,method,path,status,message,occurred_at) values('flow-test','POST',$1,$2,'fixture',$3::timestamptz)", [path, status, at(minutesAgo)]);
}
async function event(pipeline: string, level: string, message: string, minutesAgo: number) {
  await pool.query("insert into pipeline_logs(pipeline,level,message,occurred_at) values($1,$2,$3,$4::timestamptz at time zone 'UTC')", [pipeline, level, message, at(minutesAgo)]);
}

describe("read-only workflow signal collection against PostgreSQL", () => {
  it("assembles all 51 pipelines and their persisted logs through the real health service without writes", async () => {
    await error("/api/leave-requests/42", 5);
    await event("leave.request", "warn", "synthetic warning", 5);
    const report = await buildHealthReport(now);
    expect(report.pipelines).toHaveLength(51);
    expect(new Set(report.pipelines.map((p) => p.id)).size).toBe(51);
    expect(report.pipelines.map((p) => p.id)).toEqual(expect.arrayContaining(["push.delivery", "clock.never-success", "schedule.save", "audit.actor"]));
    expect(report.pipelines.every((p) => Array.isArray(p.logs) && p.logs.length <= 20)).toBe(true);
    const leave = report.pipelines.find((p) => p.id === "leave.request")!;
    expect(leave.level).toBe("red");
    expect(leave.logs).toEqual([expect.objectContaining({ pipeline: "leave.request", message: "synthetic warning" })]);
    expect((await pool.query("select count(*)::int as count from pipeline_logs")).rows[0].count).toBe(1);
    expect((await pool.query("select count(*)::int as count from system_configs")).rows[0].count).toBe(0);
  });
  it("attributes 5xx by exact route prefix and counts the 1h/24h windows", async () => {
    await error("/api/employees/4", 60);
    await error("/api/employees/4", 60.01);
    await error("/api/employees/4", 1440);
    await error("/api/employees/4", 1440.01);
    await error("/api/employees/4", -1);
    await error("/api/employees/4", 1, 400);
    await error("/api/employees-private", 1);
    await error("/api/venues/A", 120);
    const s = await collectFlowSignals(now);
    expect(s.requests["employee.manage"]).toEqual({ recent: 1, day: 3, lastFailureAt: at(60) });
    expect(s.requests["venue.manage"]).toMatchObject({ recent: 0, day: 1 });
    const lights = evaluateFlowPipelines(s);
    expect(lights.find((p) => p.id === "employee.manage")?.level).toBe("red");
    expect(lights.find((p) => p.id === "venue.manage")?.level).toBe("yellow");
    expect(lights.find((p) => p.id === "notification.manage")?.level).toBe("green");
  });

  it("counts whole-server 5xx in 15m and 24h, including unmapped API routes", async () => {
    await error("/api/unmapped", 15);
    await error("/api/unmapped", 15.01);
    await error("/api/unmapped", 1440);
    await error("/api/unmapped", 1440.01);
    await error("/api/unmapped", 1, 404);
    expect((await collectFlowSignals(now)).serverErrors).toEqual({ recent: 1, day: 3, lastFailureAt: at(15) });
  });

  it("counts only pending amendments, leave and overtime strictly older than 7 days", async () => {
    for (const [table, columns, values] of [
      ["clock_amendments", "employee_id,clock_type,requested_time,reason", "1,'in',timestamp '2026-11-01 00:00:00','fixture'"],
      ["leave_requests", "employee_id,leave_type,start_date,end_date", "1,'annual','2026-11-01','2026-11-01'"],
      ["overtime_requests", "employee_id,date,start_time,end_time,reason", "1,'2026-11-01','09:00','10:00','fixture'"],
    ]) {
      await pool.query(`insert into ${table}(${columns},status,created_at) values(${values},'pending',$1::timestamptz at time zone 'UTC'),(${values},'pending',$2::timestamptz at time zone 'UTC'),(${values},'approved',$1::timestamptz at time zone 'UTC')`, [at(7 * 1440 + 1), at(7 * 1440)]);
    }
    const s = await collectFlowSignals(now);
    expect(s.pendingReviews).toEqual({ "clock.amendment": 1, "leave.request": 1, "overtime.request": 1 });
    for (const id of Object.keys(s.pendingReviews)) expect(evaluateFlowPipelines(s).find((p) => p.id === id)).toMatchObject({ level: "yellow", reason: expect.stringContaining("1 筆") });
  });

  it("reads startup, catch-up attempts and login failures without treating completion as another attempt", async () => {
    for (let i = 0; i < 4; i++) await event("server.restarts", "info", "server.started", 60 + i);
    await event("server.restarts", "info", "other", 1);
    await event("server.restarts", "info", "server.started", 1440.01);
    await event("scheduler.catch-up", "info", "catch-up.started", 5);
    await event("scheduler.catch-up", "info", "catch-up.started", 2);
    await event("scheduler.catch-up", "info", "catch-up.completed", 1);
    await event("scheduler.catch-up", "error", "catch-up.failed", 1);
    await event("portal.login", "warn", "authentication.failed", 30);
    await event("admin.login", "error", "authentication.failed", 120);
    await event("admin.login", "info", "authentication.ok", 1);
    const s = await collectFlowSignals(now);
    expect(s.restarts).toBe(4);
    expect(s.catchUp).toEqual({ recent: 1, day: 1, attempts24h: 2, lastFailureAt: at(1) });
    expect(s.logins["portal.login"]).toMatchObject({ recent: 1, day: 1 });
    expect(s.logins["admin.login"]).toMatchObject({ recent: 0, day: 1 });
    expect(evaluateFlowPipelines(s).find((p) => p.id === "portal.login")?.level).toBe("yellow");
    expect(evaluateFlowPipelines(s).find((p) => p.id === "server.restarts")?.level).toBe("yellow");
  });

  it("counts failed LINE events by processed time and excludes successes", async () => {
    await pool.query("insert into line_webhook_events(event_id,status,received_at,processed_at) values('bad','failed',$1::timestamptz at time zone 'UTC',$2::timestamptz at time zone 'UTC'),('ok','done',$2::timestamptz at time zone 'UTC',$2::timestamptz at time zone 'UTC')", [at(120), at(5)]);
    expect((await collectFlowSignals(now)).lineWebhook).toEqual({ recent: 1, day: 1, lastFailureAt: at(5) });
  });

  it("reads persisted purge and manual attendance result without changing it", async () => {
    const state = { lastStatus: "failed", lastStartedAt: at(5), lastFailureAt: at(4) };
    await pool.query("insert into system_configs(key,value) values('health:job:errors.purge',$1),('health:job:manual.weekly-attendance',$1)", [JSON.stringify(state)]);
    const spy = vi.spyOn(pool, "query");
    let queries: unknown[][];
    let s;
    try { s = await collectFlowSignals(now); queries = spy.mock.calls; }
    finally { spy.mockRestore(); }
    expect(s.purge).toEqual(state);
    expect(s.weeklyAttendance).toEqual(state);
    expect(queries!.every((q) => typeof q[0] === "string" && /^\s*select\b/i.test(q[0]))).toBe(true);
    const { rows } = await pool.query("select value from system_configs where key='health:job:errors.purge'");
    expect(rows[0].value).toBe(JSON.stringify(state));
  });

  it("retains a swallowed manual attendance mail failure even when the job records success", async () => {
    await pool.query("insert into system_configs(key,value) values('health:job:manual.weekly-attendance',$1)", [JSON.stringify({ lastStatus: "success", lastStartedAt: at(3), lastSuccessAt: at(1) })]);
    await event("manual.weekly-attendance", "error", "mail.failed", 2);
    const s = await collectFlowSignals(now);
    expect(s.weeklyAttendanceErrors).toEqual({ recent: 1, day: 1, lastFailureAt: at(2) });
    expect(evaluateFlowPipelines(s).find((p) => p.id === "manual.weekly-attendance")?.level).toBe("red");
  });

  it("isolates a missing review table and redacts the underlying SQL failure", async () => {
    await pool.query("alter table clock_amendments rename to flow_test_clock_amendments");
    try {
      const s = await collectFlowSignals(now);
      expect(s.pendingReviews["clock.amendment"]).toEqual({ readError: "無法讀取待審補打卡申請" });
      expect(s.pendingReviews["leave.request"]).toBe(0);
      expect(s.requests["venue.manage"]).toMatchObject({ recent: 0, day: 0 });
      expect(JSON.stringify(s)).not.toContain("relation");
      expect(evaluateFlowPipelines(s).find((p) => p.id === "clock.amendment")?.level).toBe("red");
      expect(evaluateFlowPipelines(s).find((p) => p.id === "leave.request")?.level).toBe("green");
    } finally { await pool.query("alter table flow_test_clock_amendments rename to clock_amendments"); }
  });
});
