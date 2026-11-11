/**
 * 把收集到的訊號組成 health-v1 報告。純函式：同樣的訊號、同樣的時間，一定得到同樣的報告。
 * 管線清單是下面兩張表；要加一條排程管線，在 SCHEDULED_JOBS 加一筆就好。
 */
import { taipeiClock } from "../time/taipei";
import { evaluateFlowPipelines, type FlowSignals } from "./flowRules";
import {
  evaluateAuditActor,
  type AuditActorSignals,
  evaluateClockCoverage,
  evaluateClockNeverSuccess,
  evaluateDatabase,
  evaluateHolidayTable,
  evaluateIntegration,
  evaluateManualJob,
  evaluatePushDelivery,
  evaluateScheduledJob,
  evaluateScheduleSave,
  evaluateSecurity,
  evaluateSyncJob,
  evaluateWebhook,
  type ClockCoverage,
  type PushDelivery,
  type ClockNeverSuccess,
  type SecuritySignals,
  type ScheduleSaveState,
} from "./rules";
import { worst, type HealthReport, type IntegrationState, type JobSchedule, type JobState, type Pipeline } from "./types";

export const SYSTEM_ID = "workforce-scheduling";

export const SCHEDULED_JOBS: ReadonlyArray<{ id: string; name: string; schedule: JobSchedule; graceMinutes: number; flag: string }> = [
  { id: "push.shift-reminders", name: "明日班表推播（每天 19:00）", schedule: { kind: "daily", at: 19 * 60 }, graceMinutes: 30, flag: "dailyShiftReminder" },
  { id: "push.weekly-schedule", name: "下週班表推播（週日 12:00）", schedule: { kind: "weekly", weekday: 0, at: 12 * 60 }, graceMinutes: 30, flag: "weeklyShiftReminder" },
  { id: "push.missing-clock", name: "未打卡提醒（06:00–21:30 每 30 分鐘）", schedule: { kind: "every30", from: 6 * 60, to: 21 * 60 + 30 }, graceMinutes: 10, flag: "missingClockCheck" },
  { id: "report.weekly-late", name: "上週遲到報告（週一 09:00）", schedule: { kind: "weekly", weekday: 1, at: 9 * 60 }, graceMinutes: 30, flag: "weeklyLateReport" },
  { id: "push.availability-reminder", name: "排班意願提醒（每天 10:00）", schedule: { kind: "daily", at: 10 * 60 }, graceMinutes: 30, flag: "availabilityReminder" },
];

/** 只由人按按鈕觸發的工作，沒有排程。要加一個，在這裡加一筆，並讓它用 trackJob 記錄。 */
export const MANUAL_JOBS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "ragic.venue-sync", name: "Ragic 場館同步（手動）" },
];

export const INTEGRATIONS = [
  { id: "integration.line", name: "LINE 推播與回覆", key: "line" },
  { id: "integration.mail", name: "寄信（Gmail）", key: "mail" },
  { id: "integration.ragic", name: "Ragic API", key: "ragic" },
  { id: "integration.enrollment", name: "報名系統 API", key: "enrollment" },
] as const;

export type IntegrationKey = (typeof INTEGRATIONS)[number]["key"];

/** 讀不到的訊號用這個表示，對應的管線會變紅燈。 */
export interface ReadError {
  readError: string;
}

type Signal<T> = T | ReadError;

export interface HealthSignals {
  flow?: FlowSignals;
  now: Date;
  build: string;
  schedulerActive: boolean;
  flags: Record<string, boolean>;
  jobs: Record<string, Signal<JobState | undefined>>;
  integrations: Record<IntegrationKey, Signal<IntegrationState | undefined>>;
  coverage: Signal<ClockCoverage>;
  pushDelivery: Signal<PushDelivery>;
  clockNeverSuccess: Signal<ClockNeverSuccess>;
  scheduleSave: Signal<ScheduleSaveState>;
  database: { latencyMs: number | null; error?: string };
  holidayLastDate: string;
  security: SecuritySignals;
  auditActor?: Signal<AuditActorSignals>;
}

const isReadError = (v: unknown): v is ReadError => typeof v === "object" && v !== null && "readError" in v;

function unreadable(id: string, name: string, source: string, e: ReadError): Pipeline {
  return { id, name, level: "red", reason: `讀取狀態失敗：${e.readError}`, lastSuccessAt: null, lastFailureAt: null, source };
}

export function assembleReport(s: HealthSignals): HealthReport {
  const pipelines: Pipeline[] = [];
  const job = (id: string) => s.jobs[id];

  const sync = job("ragic.sync");
  pipelines.push(isReadError(sync)
    ? unreadable("ragic.employee-sync", "Ragic 員工同步", "health:job:ragic.sync", sync)
    : evaluateSyncJob({ id: "ragic.employee-sync", name: "Ragic 員工同步", source: "health:job:ragic.sync", state: sync, now: s.now }));

  const hook = job("ragic.webhook");
  pipelines.push(isReadError(hook)
    ? unreadable("ragic.h01-webhook", "H01 webhook", "health:job:ragic.webhook", hook)
    : evaluateWebhook({ id: "ragic.h01-webhook", name: "H01 webhook", source: "health:job:ragic.webhook", state: hook, now: s.now }));

  pipelines.push(isReadError(s.coverage)
    ? unreadable("clock.coverage", "打卡", "clock_records", s.coverage)
    : evaluateClockCoverage({ id: "clock.coverage", name: "打卡", source: "clock_records", coverage: s.coverage }));

  pipelines.push(isReadError(s.pushDelivery)
    ? unreadable("push.delivery", "推播送達", "push_dedup", s.pushDelivery)
    : evaluatePushDelivery({ id: "push.delivery", name: "推播送達", source: "push_dedup", delivery: s.pushDelivery }));

  for (const j of SCHEDULED_JOBS) {
    const state = job(j.id);
    const source = `health:job:${j.id}`;
    pipelines.push(isReadError(state)
      ? unreadable(j.id, j.name, source, state)
      : evaluateScheduledJob({ id: j.id, name: j.name, source, schedule: j.schedule, graceMinutes: j.graceMinutes, enabled: s.flags[j.flag] ?? true, schedulerActive: s.schedulerActive, state, now: s.now }));
  }

  for (const j of MANUAL_JOBS) {
    const state = job(j.id);
    const source = `health:job:${j.id}`;
    pipelines.push(isReadError(state) ? unreadable(j.id, j.name, source, state) : evaluateManualJob({ id: j.id, name: j.name, source, state }));
  }

  for (const i of INTEGRATIONS) {
    const state = s.integrations[i.key];
    const source = `health:integration:${i.key}`;
    pipelines.push(isReadError(state) ? unreadable(i.id, i.name, source, state) : evaluateIntegration({ id: i.id, name: i.name, source, state }));
  }

  pipelines.push(evaluateDatabase({ id: "database", name: "資料庫", source: "select 1", latencyMs: s.database.latencyMs, error: s.database.error }));
  pipelines.push(evaluateHolidayTable({ id: "holiday-table", name: "國定假日表", source: "server/core/calendar/taiwanHolidays.ts", lastDate: s.holidayLastDate, today: taipeiClock(s.now).date }));
  pipelines.push(evaluateSecurity({ id: "security-config", name: "安全設定", source: "環境變數", signals: s.security }));
  pipelines.push(isReadError(s.clockNeverSuccess) ? unreadable("clock.never-success", "有班沒打卡", "shifts / clock_records", { readError: "有班沒打卡訊號讀取失敗" }) : evaluateClockNeverSuccess({ id: "clock.never-success", name: "有班沒打卡", source: "shifts / clock_records", signals: s.clockNeverSuccess }));

  pipelines.push(isReadError(s.scheduleSave)
    ? unreadable("schedule.save", "排班儲存", "app_errors", s.scheduleSave)
    : evaluateScheduleSave({ id: "schedule.save", name: "排班儲存", source: "app_errors", state: s.scheduleSave, now: s.now }));
  pipelines.push(isReadError(s.auditActor) ? unreadable("audit.actor", "操作紀錄", "audit_mutations", s.auditActor) : evaluateAuditActor({ id: "audit.actor", name: "操作紀錄", source: "audit_mutations", signals: s.auditActor }));
  if (s.flow) pipelines.push(...evaluateFlowPipelines(s.flow));

  return {
    system: SYSTEM_ID,
    build: s.build,
    checkedAt: s.now.toISOString(),
    overall: worst(pipelines.map((p) => p.level)),
    pipelines,
  };
}
