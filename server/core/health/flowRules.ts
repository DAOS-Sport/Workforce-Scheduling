/** Route attribution is shared by logging and read-only health collection. No I/O belongs here. */
import { worst, type JobState, type Level, type Pipeline } from "./types";
import { evaluateManualJob, evaluateScheduledJob } from "./rules";

export interface FlowDefinition { id: string; name: string; paths: readonly string[] }

export const FLOW_DEFINITIONS: readonly FlowDefinition[] = [
  { id: "clock.amendment", name: "補打卡申請與審核", paths: ["/api/clock-amendments", "/api/portal/clock-amendment", "/api/portal/clock-amendments", "/api/portal/amendment-eligible-dates"] },
  { id: "leave.request", name: "請假申請、審核與餘額", paths: ["/api/leave-requests", "/api/leave-balances", "/api/portal/leave-request", "/api/portal/leave-requests", "/api/portal/leave-summary"] },
  { id: "overtime.request", name: "加班申請與審核", paths: ["/api/overtime-requests", "/api/portal/overtime-request", "/api/portal/overtime-requests"] },
  { id: "availability.submit", name: "排班意願填報與查詢", paths: ["/api/availabilities", "/api/portal/availability", "/api/portal/my-availabilities", "/api/portal/availability-window", "/api/portal/monthly-holidays"] },
  { id: "dispatch.manage", name: "派遣班次管理", paths: ["/api/dispatch-shifts", "/api/dispatch-shifts-cancelled"] },
  { id: "anomaly.report", name: "異常回報與處理", paths: ["/api/anomaly-report", "/api/anomaly-reports"] },
  { id: "guideline.ack", name: "工作須知與簽收", paths: ["/api/guidelines", "/api/guideline-ack", "/api/portal/guidelines", "/api/portal/guidelines-check", "/api/portal/acknowledge-all"] },
  { id: "attendance.import", name: "出勤匯入與紀錄", paths: ["/api/attendance-upload", "/api/attendance-uploads", "/api/attendance-records"] },
  { id: "summer.schedule", name: "暑假排班、課程匯入與發布", paths: ["/api/admin/summer-employees", "/api/admin/summer-schedule", "/api/admin/summer-availability", "/api/admin/schedule-assignments", "/api/admin/manual-schedule-courses", "/api/schedule", "/api/portal/summer-availability", "/api/portal/my-summer-shifts"] },
  { id: "portal.login", name: "員工入口登入", paths: ["/api/portal/dev-login", "/api/portal/dev-employees", "/api/portal/line-callback", "/api/portal/verify"] },
  { id: "portal.read", name: "員工入口班表、出勤與外出", paths: ["/api/portal/my-shifts", "/api/portal/shifts", "/api/portal/my-attendance", "/api/portal/upcoming-coworkers", "/api/portal/workmates", "/api/portal/outing-record", "/api/portal/outing-records", "/api/outing-records"] },
  { id: "admin.login", name: "管理員登入", paths: ["/api/admin/login", "/api/admin/dev-login", "/api/admin/me", "/api/admin/logout"] },
  { id: "employee.manage", name: "員工管理", paths: ["/api/employees", "/api/employees-all"] },
  { id: "venue.manage", name: "場館與地區管理", paths: ["/api/venues", "/api/venues-all", "/api/regions", "/api/portal/region-hours"] },
  { id: "system.config", name: "系統設定與薪資費率", paths: ["/api/system-config", "/api/salary-rates"] },
  { id: "payroll.report", name: "薪資報表與四週合規", paths: ["/api/salary-report", "/api/four-week-compliance"] },
  { id: "notification.manage", name: "通知收件人與測試信", paths: ["/api/notification-recipients", "/api/test-email"] },
  { id: "announcement.manage", name: "公告與待辦統計", paths: ["/api/announcements", "/api/pending-counts"] },
  { id: "mcp", name: "MCP 工具入口", paths: ["/mcp"] },
  { id: "internal.api", name: "內部查詢與匯出 API", paths: ["/api/internal"] },
  { id: "schedule.slots", name: "排班時段、需求與範本", paths: ["/api/schedule-slots", "/api/venue-requirements", "/api/venue-shift-templates"] },
  { id: "shift.manage", name: "一般班次管理", paths: ["/api/shifts", "/api/shifts-cancelled"] },
  { id: "clock.records", name: "打卡紀錄與原因補登", paths: ["/api/clock-records", "/api/reports/clock-records", "/api/reports/anomalies", "/api/portal/clock-records"] },
  { id: "clock.entry", name: "LIFF 打卡入口", paths: ["/api/liff/clock-in"] },
  { id: "manual.weekly-attendance", name: "每週出勤報表與手動通知", paths: ["/api/weekly-attendance"] },
  { id: "line.webhook", name: "LINE webhook 事件處理", paths: ["/api/line/webhook"] },
  { id: "errors.browse", name: "錯誤紀錄查詢", paths: ["/api/admin/errors"] },
];

const EXISTING_ROUTES: readonly FlowDefinition[] = [
  { id: "ragic.h01-webhook", name: "", paths: ["/api/ragic/webhook/h01"] },
  { id: "ragic.employee-sync", name: "", paths: ["/api/ragic-sync", "/api/ragic/sync-employees"] },
  { id: "ragic.venue-sync", name: "", paths: ["/api/ragic-venue-sync", "/api/ragic/sync-venues"] },
  { id: "push.shift-reminders", name: "", paths: ["/api/send-shift-reminders"] },
  { id: "push.weekly-schedule", name: "", paths: ["/api/admin/trigger-weekly-schedule", "/api/internal/trigger-weekly-schedule"] },
  { id: "report.weekly-late", name: "", paths: ["/api/admin/trigger-weekly-late-report"] },
];

export function pipelineForPath(path: string): string | undefined {
  const pathname = path.split("?", 1)[0].toLowerCase();
  let match: { id: string; length: number } | undefined;
  for (const d of [...FLOW_DEFINITIONS, ...EXISTING_ROUTES]) {
    for (const prefix of d.paths) {
      if ((pathname === prefix || pathname.startsWith(prefix + "/")) && (!match || prefix.length > match.length)) {
        match = { id: d.id, length: prefix.length };
      }
    }
  }
  return match?.id;
}

export function pipelineForJob(job: string): string {
  return job === "ragic.sync" ? "ragic.employee-sync" : job === "ragic.webhook" ? "ragic.h01-webhook" : job;
}

export interface FlowReadError { readError: string }
export type FlowSignal<T> = T | FlowReadError;
/** recent is the last hour, except server.errors which uses 15 minutes. */
export interface FlowErrorWindow { recent: number; day: number; lastFailureAt: string | null }
export const REVIEW_FLOW_IDS = ["clock.amendment", "leave.request", "overtime.request"] as const;
export type ReviewFlowId = typeof REVIEW_FLOW_IDS[number];
export type LoginFlowId = "portal.login" | "admin.login";
export interface FlowSignals {
  now: Date;
  schedulerActive: boolean;
  requests: Record<string, FlowSignal<FlowErrorWindow>>;
  pendingReviews: Record<ReviewFlowId, FlowSignal<number>>;
  serverErrors: FlowSignal<FlowErrorWindow>;
  restarts: FlowSignal<number>;
  lineWebhook: FlowSignal<FlowErrorWindow>;
  logins: Record<LoginFlowId, FlowSignal<FlowErrorWindow>>;
  catchUp: FlowSignal<FlowErrorWindow & { attempts24h: number }>;
  purge: FlowSignal<JobState | undefined>;
  weeklyAttendance: FlowSignal<JobState | undefined>;
  weeklyAttendanceErrors: FlowSignal<FlowErrorWindow>;
}

const unreadable = (value: unknown): value is FlowReadError => typeof value === "object" && value !== null && "readError" in value;
const light = (d: Pick<FlowDefinition, "id" | "name">, level: Level, reason: string, source: string, lastFailureAt: string | null = null): Pipeline =>
  ({ id: d.id, name: d.name, level, reason, source, lastFailureAt, lastSuccessAt: null });
// A job's raw exception can contain names or record ids; the lamp reason is count/time-only.
const jobForReason = (state: JobState | undefined): JobState | undefined => state
  ? { ...state, lastError: state.lastError ? "詳細內容請查管線日誌" : undefined } : undefined;

function errors(d: Pick<FlowDefinition, "id" | "name">, signal: FlowSignal<FlowErrorWindow> | undefined, source: string, recentName = "1 小時", warningOnly = false): Pipeline {
  if (!signal) return light(d, "yellow", "無法觀測：沒有訊號", source);
  if (unreadable(signal)) return light(d, "red", "無法觀測：讀取訊號失敗", source);
  return light(d, signal.recent > 0 && !warningOnly ? "red" : signal.day > 0 ? "yellow" : "green",
    `${recentName}內 ${signal.recent} 筆失敗；24 小時內 ${signal.day} 筆失敗`, source, signal.lastFailureAt);
}

function combine(a: Pipeline, b: Pipeline): Pipeline {
  const latest = [a.lastFailureAt, b.lastFailureAt].filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
  const recoveredAt = b.recoveredAt ?? a.recoveredAt;
  return { ...a, level: worst([a.level, b.level]), reason: `${a.reason}；${b.reason}`, source: `${a.source}；${b.source}`, lastFailureAt: latest, lastSuccessAt: b.lastSuccessAt ?? a.lastSuccessAt,
    ...(recoveredAt && latest && Date.parse(recoveredAt) > Date.parse(latest) ? { recoveredAt } : {}) };
}

export function evaluateFlowPipelines(s: FlowSignals): Pipeline[] {
  const pipelines = FLOW_DEFINITIONS.map((d) => {
    let p = errors(d, s.requests[d.id], "app_errors（路由 5xx）");
    if (REVIEW_FLOW_IDS.includes(d.id as ReviewFlowId)) {
      const pending = s.pendingReviews[d.id as ReviewFlowId];
      p = combine(p, light(d, unreadable(pending) ? "red" : pending > 0 ? "yellow" : "green",
        unreadable(pending) ? "無法觀測：讀取待審申請失敗" : `超過 7 天待審 ${pending} 筆`, `${d.id} pending created_at`));
    }
    if (d.id === "portal.login" || d.id === "admin.login") p = combine(p, errors(d, s.logins[d.id], "app_logs（登入驗證失敗）", "1 小時", true));
    if (d.id === "line.webhook") p = combine(p, errors(d, s.lineWebhook, "line_webhook_events（failed）"));
    if (d.id === "manual.weekly-attendance") {
      p = combine(p, errors(d, s.weeklyAttendanceErrors, "app_logs（manual.weekly-attendance error）"));
      const state = s.weeklyAttendance;
      p = combine(p, unreadable(state)
        ? light(d, "red", "無法觀測：讀取手動通知結果失敗", "health:job:manual.weekly-attendance")
        : evaluateManualJob({ ...d, source: "health:job:manual.weekly-attendance", state: jobForReason(state) }));
    }
    return p;
  });
  pipelines.push(errors({ id: "server.errors", name: "全站伺服器錯誤" }, s.serverErrors, "app_errors（全站 5xx）", "15 分鐘"));
  const catchUp = errors({ id: "scheduler.catch-up", name: "排程補跑" }, s.catchUp, "app_logs（scheduler.catch-up）");
  if (!unreadable(s.catchUp)) catchUp.reason += `；24 小時補跑 ${s.catchUp.attempts24h} 次`;
  pipelines.push(catchUp);
  const restart = { id: "server.restarts", name: "伺服器啟動次數" };
  pipelines.push(unreadable(s.restarts)
    ? light(restart, "yellow", "無法觀測：讀取啟動次數失敗", "app_logs（server.restarts startup）")
    : light(restart, s.restarts > 3 ? "yellow" : "green", `24 小時啟動 ${s.restarts} 次（超過 3 次提醒）`, "app_logs（server.restarts startup）"));
  const purge = { id: "errors.purge", name: "錯誤紀錄清理（每天 04:00）", source: "health:job:errors.purge" };
  pipelines.push(unreadable(s.purge)
    ? light(purge, "red", "無法觀測：讀取清理結果失敗", purge.source)
    : evaluateScheduledJob({ ...purge, state: jobForReason(s.purge), schedule: { kind: "daily", at: 4 * 60 }, graceMinutes: 30, enabled: true, schedulerActive: s.schedulerActive, now: s.now }));
  return pipelines;
}
