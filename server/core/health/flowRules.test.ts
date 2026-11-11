import { describe, expect, it } from "vitest";
import { FLOW_DEFINITIONS, evaluateFlowPipelines, pipelineForJob, pipelineForPath, type FlowSignals } from "./flowRules";

const now = new Date("2026-11-11T04:00:00.000Z");
const clear = () => ({ recent: 0, day: 0, lastFailureAt: null });
function healthy(): FlowSignals {
  return {
    now, schedulerActive: true,
    requests: Object.fromEntries(FLOW_DEFINITIONS.map((d) => [d.id, clear()])),
    pendingReviews: { "clock.amendment": 0, "leave.request": 0, "overtime.request": 0 },
    serverErrors: clear(), restarts: 3, lineWebhook: clear(),
    logins: { "portal.login": clear(), "admin.login": clear() },
    catchUp: { ...clear(), attempts24h: 2 },
    purge: { lastStatus: "success", lastStartedAt: "2026-11-10T20:00:00.000Z", lastSuccessAt: "2026-11-10T20:01:00.000Z" },
    weeklyAttendance: undefined, weeklyAttendanceErrors: clear(),
  };
}
const get = (s: FlowSignals, id: string) => evaluateFlowPipelines(s).find((p) => p.id === id)!;

describe("workflow routes", () => {
  it("matches Express case-insensitive routes", () => {
    expect(pipelineForPath("/API/EMPLOYEES/42")).toBe("employee.manage");
    expect(pipelineForPath("/API/ADMIN/LOGIN")).toBe("admin.login");
  });
  it.each([
    ["/api/portal/clock-amendment", "clock.amendment"], ["/api/portal/leave-requests/3", "leave.request"],
    ["/api/overtime-requests/3", "overtime.request"], ["/api/portal/availability", "availability.submit"],
    ["/api/dispatch-shifts-cancelled/A/2026-11-01/2026-11-30", "dispatch.manage"],
    ["/api/anomaly-reports/1", "anomaly.report"], ["/api/portal/acknowledge-all", "guideline.ack"],
    ["/api/guideline-ack", "guideline.ack"], ["/api/liff/clock-in", "clock.entry"],
    ["/api/attendance-upload", "attendance.import"], ["/api/admin/manual-schedule-courses/1", "summer.schedule"],
    ["/api/portal/line-callback", "portal.login"], ["/api/portal/my-shifts/1/2026-11-01/2026-11-30", "portal.read"],
    ["/api/admin/login?next=x", "admin.login"], ["/api/employees-all", "employee.manage"],
    ["/api/portal/region-hours/A", "venue.manage"], ["/api/system-config/a", "system.config"],
    ["/api/salary-report/excel", "payroll.report"], ["/api/test-email", "notification.manage"],
    ["/api/pending-counts", "announcement.manage"], ["/mcp", "mcp"], ["/api/internal/export/snapshot", "internal.api"],
    ["/api/venue-shift-templates/batch/1", "schedule.slots"], ["/api/reports/clock-records", "clock.records"],
    ["/api/weekly-attendance/notify", "manual.weekly-attendance"], ["/api/line/webhook", "line.webhook"],
    ["/api/admin/errors", "errors.browse"], ["/api/shifts/batch", "shift.manage"],
    ["/api/ragic/webhook/h01", "ragic.h01-webhook"], ["/api/ragic/sync-employees", "ragic.employee-sync"],
    ["/api/ragic-venue-sync", "ragic.venue-sync"], ["/api/admin/trigger-weekly-schedule", "push.weekly-schedule"],
  ])("maps %s to %s", (path, id) => expect(pipelineForPath(path)).toBe(id));

  it("does not confuse a shared prefix with an unrelated route", () => {
    expect(pipelineForPath("/api/employees-private")).toBeUndefined();
    expect(pipelineForPath("/api/health/pipelines")).toBeUndefined();
  });
  it("maps jobs without importing a service", () => {
    expect(pipelineForJob("ragic.sync")).toBe("ragic.employee-sync");
    expect(pipelineForJob("ragic.webhook")).toBe("ragic.h01-webhook");
    expect(pipelineForJob("manual.weekly-attendance")).toBe("manual.weekly-attendance");
    expect(pipelineForJob("errors.purge")).toBe("errors.purge");
  });
});

it.each(["manual.weekly-attendance", "errors.purge"])("%s keeps raw job errors out of public lamp reasons", (id) => {
  const s = healthy();
  const state = { lastStatus: "failed" as const, lastStartedAt: now.toISOString(), lastFailureAt: now.toISOString(), lastError: "SyntheticName employeeId=4242 mail@example.test" };
  if (id === "errors.purge") s.purge = state;
  else s.weeklyAttendance = state;
  expect(get(s, id).reason).not.toMatch(/SyntheticName|employeeId=4242|mail@example.test/);
});

describe("all HTTP workflow lights", () => {
  it("has no duplicate ids", () => expect(new Set(FLOW_DEFINITIONS.map((d) => d.id)).size).toBe(FLOW_DEFINITIONS.length));
  it.each(FLOW_DEFINITIONS.flatMap((d) => (["green", "yellow", "red"] as const).map((level) => ({ id: d.id, level }))))("$id is $level for its error window", ({ id, level }) => {
      const s = healthy();
      s.requests[id] = { recent: level === "red" ? 1 : 0, day: level === "green" ? 0 : 2, lastFailureAt: level === "green" ? null : "2026-11-11T03:30:00.000Z" };
      expect(get(s, id).level).toBe(level);
  });
  it("a read failure affects its own workflow and does not expose the database error", () => {
    const s = healthy(); s.requests["employee.manage"] = { readError: "unavailable" };
    expect(get(s, "employee.manage").level).toBe("red");
    expect(get(s, "venue.manage").level).toBe("green");
  });
  it.each(["clock.amendment", "leave.request", "overtime.request"] as const)("%s warns with the stale pending count", (id) => {
    const s = healthy(); s.pendingReviews[id] = 4;
    expect(get(s, id)).toMatchObject({ level: "yellow", reason: expect.stringContaining("4 筆") });
    expect(get(healthy(), id).level).toBe("green");
    s.pendingReviews[id] = { readError: "unavailable" };
    expect(get(s, id).level).toBe("red");
  });
  it.each(["portal.login", "admin.login"] as const)("%s includes recorded auth failures", (id) => {
    const s = healthy(); s.logins[id] = { recent: 1, day: 1, lastFailureAt: "2026-11-11T03:59:00.000Z" };
    expect(get(s, id).level).toBe("yellow");
    s.logins[id] = { recent: 0, day: 1, lastFailureAt: "2026-11-10T10:00:00.000Z" };
    expect(get(s, id).level).toBe("yellow");
  });
  it("includes persisted LINE webhook failure events", () => {
    const s = healthy(); s.lineWebhook = { recent: 1, day: 1, lastFailureAt: "2026-11-11T03:50:00.000Z" };
    expect(get(s, "line.webhook").level).toBe("red");
    s.lineWebhook = { recent: 0, day: 1, lastFailureAt: "2026-11-10T10:00:00.000Z" };
    expect(get(s, "line.webhook").level).toBe("yellow");
  });
  it("retains manual weekly-attendance results without requiring a schedule", () => {
    const s = healthy(); expect(get(s, "manual.weekly-attendance").level).toBe("green");
    s.weeklyAttendance = { lastStartedAt: "2026-11-11T02:00:00.000Z", lastFailureAt: "2026-11-11T02:01:00.000Z", lastStatus: "failed" };
    expect(get(s, "manual.weekly-attendance").level).toBe("yellow");
    s.weeklyAttendance.lastSuccessAt = "2026-11-11T03:00:00.000Z";
    s.weeklyAttendance.recoveredAt = "2026-11-11T03:00:00.000Z";
    expect(get(s, "manual.weekly-attendance").level).toBe("green");
    s.weeklyAttendanceErrors = { recent: 1, day: 1, lastFailureAt: "2026-11-11T03:50:00.000Z" };
    expect(get(s, "manual.weekly-attendance").level).toBe("red");
    expect(get(s, "manual.weekly-attendance").recoveredAt).toBeUndefined();
  });
});

describe("server and scheduler lights", () => {
  it.each(["server.errors", "scheduler.catch-up"])("%s has green/yellow/red counts", (id) => {
    const s = healthy(); expect(get(s, id).level).toBe("green");
    if (id === "server.errors") s.serverErrors = { recent: 0, day: 2, lastFailureAt: "2026-11-10T10:00:00.000Z" };
    else s.catchUp = { recent: 0, day: 2, lastFailureAt: "2026-11-10T10:00:00.000Z", attempts24h: 6 };
    expect(get(s, id).level).toBe("yellow");
    if (id === "server.errors") s.serverErrors = { recent: 1, day: 2, lastFailureAt: "2026-11-11T03:59:00.000Z" };
    else s.catchUp = { recent: 1, day: 2, lastFailureAt: "2026-11-11T03:59:00.000Z", attempts24h: 6 };
    expect(get(s, id).level).toBe("red");
    if (id === "scheduler.catch-up") expect(get(s, id).reason).toContain("6 次");
  });
  it("restart count only changes green/yellow, including a read failure", () => {
    const s = healthy(); expect(get(s, "server.restarts").level).toBe("green");
    s.restarts = 4; expect(get(s, "server.restarts")).toMatchObject({ level: "yellow", reason: expect.stringContaining("4 次") });
    s.restarts = { readError: "unavailable" }; expect(get(s, "server.restarts").level).toBe("yellow");
  });
  it.each(["serverErrors", "catchUp", "purge", "weeklyAttendance", "weeklyAttendanceErrors", "lineWebhook"] as const)("%s read failure turns only its own light red", (key) => {
    const s = healthy(); s[key] = { readError: "unavailable" };
    const id = { serverErrors: "server.errors", catchUp: "scheduler.catch-up", purge: "errors.purge", weeklyAttendance: "manual.weekly-attendance", weeklyAttendanceErrors: "manual.weekly-attendance", lineWebhook: "line.webhook" }[key];
    expect(get(s, id).level).toBe("red");
    expect(get(s, "venue.manage").level).toBe("green");
  });
  it("purge reports last scheduled success, missed run and unavailable scheduler", () => {
    const s = healthy(); expect(get(s, "errors.purge").level).toBe("green");
    s.purge = undefined; expect(get(s, "errors.purge").level).toBe("yellow");
    s.purge = { lastStartedAt: "2026-11-10T20:00:00.000Z", lastFailureAt: "2026-11-10T20:01:00.000Z", lastStatus: "failed" };
    expect(get(s, "errors.purge").level).toBe("red");
    s.schedulerActive = false; expect(get(s, "errors.purge").level).toBe("yellow");
  });
});
