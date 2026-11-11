import cron from "node-cron";
import { drainRagicEvents, runRagicSync } from "../modules/ragic/ragic.service";
import {
  sendShiftReminders,
  checkMissingClockIn,
  sendWeeklySchedulePush,
  sendWeeklyLateReport,
  sendAvailabilityReminders,
} from "../modules/line/linePush.service";
import { purgeOldErrors } from "../modules/errors/errors.service";
import { featureFlags } from "../config/featureFlags";
import { IS_PRODUCTION } from "../config/env";
import { SCHEDULED_JOBS } from "../core/health/report";
import type { CatchUpJob, SlotSchedule } from "../shared/health/catchUp";
import type { JobTrigger } from "../shared/health/healthState";
import { runJob } from "../shared/health/runJob";
import { log } from "../shared/log";
import { withPipeline } from "../shared/logging/context";
import { pipelineForJob } from "../core/health/flowRules";

/** How each job runs. Cron and the wake-up catch-up (catchUpJobs) both start a job through here, so they share its lock and record. */
const runs = {
  "push.shift-reminders": (trigger: JobTrigger) => runJob("push.shift-reminders", trigger, () => sendShiftReminders(), (r) => ({ ...r })),
  "push.missing-clock": (trigger: JobTrigger) => runJob("push.missing-clock", trigger, () => checkMissingClockIn(), (r) => ({ ...r })),
  "push.weekly-schedule": (trigger: JobTrigger) => runJob("push.weekly-schedule", trigger, () => sendWeeklySchedulePush(), (r) => ({ ...r })),
  "push.availability-reminder": (trigger: JobTrigger) => runJob("push.availability-reminder", trigger, () => sendAvailabilityReminders(), (r) => ({ ...r })),
  "report.weekly-late": (trigger: JobTrigger) => runJob("report.weekly-late", trigger, () => sendWeeklyLateReport(), (r) => ({ ...r })),
  "errors.purge": (trigger: JobTrigger) => runJob("errors.purge", trigger, () => purgeOldErrors(), (r) => ({ ...r })),
};

const RAGIC_SYNC_SCHEDULE: SlotSchedule = { kind: "daily", at: 3 * 60 };
const ERRORS_PURGE_SCHEDULE: SlotSchedule = { kind: "daily", at: 4 * 60 };
/** A push for a slot that was missed still goes out until 23:00 that day; later, "tomorrow's shifts" would arrive after midnight. */
const PUSH_CLOSES_AT = 23 * 60;

/**
 * The jobs that run on the first request after their slot when no instance was awake at the slot (Autoscale).
 * Times come from SCHEDULED_JOBS, the table the health lights read. Production only, like the cron jobs.
 */
export function catchUpJobs(): CatchUpJob[] {
  if (!IS_PRODUCTION) return [];
  const flags: Record<string, boolean> = featureFlags;
  const pushes = SCHEDULED_JOBS.flatMap((job): CatchUpJob[] => {
    const run = runs[job.id as keyof typeof runs];
    if (job.schedule.kind === "every30" || !flags[job.flag] || !run) return [];
    return [{ id: job.id, schedule: job.schedule, closesAt: PUSH_CLOSES_AT, run: () => run("startup") }];
  });
  return [
    ...(featureFlags.ragicSync ? [{ id: "ragic.sync", schedule: RAGIC_SYNC_SCHEDULE, run: () => runRagicSync("startup") }] : []),
    ...pushes,
    { id: "errors.purge", schedule: ERRORS_PURGE_SCHEDULE, run: () => runs["errors.purge"]("startup") },
  ];
}

/** Another instance, or a manual trigger, is still running this job; this round has nothing to do. */
function logBusy(job: string): void {
  withPipeline(pipelineForJob(job), () => log(`${job} 已有另一個執行個體在執行，本輪略過`, "warn"));
}

/**
 * Single, central place that decides whether cron should run AT ALL,
 * and registers every cron job.
 *
 * Critical rule (preserved from the old monolithic index.ts):
 *   We ONLY register cron jobs when REPLIT_DEPLOYMENT === "1".
 *   In dev or preview the database may be incomplete; running the
 *   reminder/missing-clock-in jobs on it would fire wrong LINE
 *   notifications to real employees. So in dev we skip everything.
 *
 * Individual jobs can additionally be disabled via featureFlags
 * (e.g. FEATURE_RAGIC_SYNC=false) without a code change.
 */
export function registerCronJobs(): void {
  if (!IS_PRODUCTION) {
    log(
      "開發環境：已略過所有排程工作（避免 dev DB 資料不完整導致誤發 LINE 通知給員工）",
      "cron",
    );
    return;
  }

  // 03:00 daily — sync employee data from Ragic.
  if (featureFlags.ragicSync) {
    cron.schedule(
      "0 3 * * *",
      async () => {
        log("開始執行每日 Ragic 員工同步...", "cron");
        try {
          const run = await runRagicSync("cron");
          if (run.busy) return logBusy("ragic.sync");
          const syncResult = run.result;
          log(
            `Ragic 同步完成: 新增 ${syncResult.created}, 更新 ${syncResult.updated}, 停用 ${syncResult.deactivated}, 跳過 ${syncResult.skipped}, 錯誤 ${syncResult.errors.length}`,
            "cron",
          );
          if (syncResult.errors.length > 0) {
            log(`同步錯誤: ${syncResult.errors.slice(0, 10).join("; ")}`, "cron");
          }
        } catch (err: any) {
          withPipeline("ragic.employee-sync", () => log(`Ragic 同步失敗: ${err.message}`, "error"));
        }
      },
      { timezone: "Asia/Taipei" },
    );
    log("已排程每日凌晨 3:00 (台灣時間) 自動執行 Ragic 同步", "cron");

    // Every 5 minutes — run the sync that a webhook, or a run that found the lock taken, left waiting.
    cron.schedule(
      "*/5 * * * *",
      async () => {
        try {
          await drainRagicEvents();
        } catch (err: any) {
          withPipeline("ragic.employee-sync", () => log(`Ragic 補跑失敗: ${err.message}`, "error"));
        }
      },
      { timezone: "Asia/Taipei" },
    );
  }

  // 19:00 daily — push tomorrow's shifts via LINE.
  if (featureFlags.dailyShiftReminder) {
    cron.schedule(
      "0 19 * * *",
      async () => {
        log("開始執行明日班表推撥通知...", "cron");
        try {
          const run = await runs["push.shift-reminders"]("cron");
          if (run.busy) return logBusy("push.shift-reminders");
          const result = run.value;
          log(
            `班表推撥完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`,
            "cron",
          );
        } catch (err: any) {
          withPipeline("push.shift-reminders", () => log(`班表推撥失敗: ${err.message}`, "error"));
        }
      },
      { timezone: "Asia/Taipei" },
    );
    log("已排程每日 19:00 (台灣時間) 自動推撥明日班表", "cron");
  }

  // Every 30 minutes between 06:00 and 21:30 — missing clock-in check.
  if (featureFlags.missingClockCheck) {
    cron.schedule(
      "*/30 6-21 * * *",
      async () => {
        log("開始檢查未打卡員工...", "cron");
        try {
          const run = await runs["push.missing-clock"]("cron");
          if (run.busy) return logBusy("push.missing-clock");
          const result = run.value;
          log(
            `未打卡檢查完成: 通知 ${result.notified}, 跳過 ${result.skipped}`,
            "cron",
          );
        } catch (err: any) {
          withPipeline("push.missing-clock", () => log(`未打卡檢查失敗: ${err.message}`, "error"));
        }
      },
      { timezone: "Asia/Taipei" },
    );
    log("已排程每 30 分鐘（06:00-21:30）檢查未打卡員工", "cron");
  }

  // Sunday 12:00 (noon) — push next-week schedule.
  if (featureFlags.weeklyShiftReminder) {
    cron.schedule(
      "0 12 * * 0",
      async () => {
        log("開始執行每週下週班表推播...", "cron");
        try {
          const run = await runs["push.weekly-schedule"]("cron");
          if (run.busy) return logBusy("push.weekly-schedule");
          const result = run.value;
          log(
            `週班表推播完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`,
            "cron",
          );
        } catch (err: any) {
          withPipeline("push.weekly-schedule", () => log(`週班表推播失敗: ${err.message}`, "error"));
        }
      },
      { timezone: "Asia/Taipei" },
    );
    log("已排程每週日 12:00 (台灣時間) 自動推播下週班表", "cron");
  }

  // 10:00 daily — remind employees who haven't submitted shift availability.
  if (featureFlags.availabilityReminder) {
    cron.schedule(
      "0 10 * * *",
      async () => {
        log("開始執行意願填報未填提醒...", "cron");
        try {
          const run = await runs["push.availability-reminder"]("cron");
          if (run.busy) return logBusy("push.availability-reminder");
          const result = run.value;
          if (result.windowClosed) {
            log("意願提醒：目前無符合條件的開放視窗，略過", "cron");
          } else {
            log(
              `意願填報提醒完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`,
              "cron",
            );
          }
        } catch (err: any) {
          withPipeline("push.availability-reminder", () => log(`意願填報提醒失敗: ${err.message}`, "error"));
        }
      },
      { timezone: "Asia/Taipei" },
    );
    log("已排程每日 10:00 (台灣時間) 自動提醒尚未填報意願的員工", "cron");
  }

  // Monday 09:00 — push last-week late report.
  if (featureFlags.weeklyLateReport) {
    cron.schedule(
      "0 9 * * 1",
      async () => {
        log("開始執行上週遲到報告推播...", "cron");
        try {
          const run = await runs["report.weekly-late"]("cron");
          if (run.busy) return logBusy("report.weekly-late");
          const result = run.value;
          log(
            `週遲到報告推播完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`,
            "cron",
          );
        } catch (err: any) {
          withPipeline("report.weekly-late", () => log(`週遲到報告推播失敗: ${err.message}`, "error"));
        }
      },
      { timezone: "Asia/Taipei" },
    );
    log("已排程每週一 09:00 (台灣時間) 自動推播上週遲到報告", "cron");
  }

  // 04:00 daily — delete error records past their retention period.
  cron.schedule(
    "0 4 * * *",
    async () => {
      try {
        const run = await runs["errors.purge"]("cron");
        if (run.busy) return logBusy("errors.purge");
        log(`錯誤紀錄清理完成: 刪除 ${run.value.deleted} 筆`, "cron");
      } catch (err: any) {
        withPipeline("errors.purge", () => log(`錯誤紀錄清理失敗: ${err.message}`, "error"));
      }
    },
    { timezone: "Asia/Taipei" },
  );
}
