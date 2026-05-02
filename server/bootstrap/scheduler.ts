import cron from "node-cron";
import { syncFromRagic } from "../ragic";
import {
  sendShiftReminders,
  checkMissingClockIn,
  resetMissingClockInTracker,
  sendWeeklySchedulePush,
  sendWeeklyLateReport,
} from "../line-webhook";
import { log } from "../shared/log";

/**
 * Single, central place that decides whether cron should run AT ALL,
 * and registers every cron job.
 *
 * Critical rule (preserved from the old monolithic index.ts):
 *   We ONLY register cron jobs when REPLIT_DEPLOYMENT === "1".
 *   In dev or preview the database may be incomplete; running the
 *   reminder/missing-clock-in jobs on it would fire wrong LINE
 *   notifications to real employees. So in dev we skip everything.
 */
export function registerCronJobs(): void {
  if (process.env.REPLIT_DEPLOYMENT !== "1") {
    log(
      "開發環境：已略過所有排程工作（避免 dev DB 資料不完整導致誤發 LINE 通知給員工）",
      "cron",
    );
    return;
  }

  // 03:00 daily — sync employee data from Ragic.
  cron.schedule(
    "0 3 * * *",
    async () => {
      log("開始執行每日 Ragic 員工同步...", "cron");
      try {
        const syncResult = await syncFromRagic();
        log(
          `Ragic 同步完成: 新增 ${syncResult.created}, 更新 ${syncResult.updated}, 停用 ${syncResult.deactivated}, 跳過 ${syncResult.skipped}, 錯誤 ${syncResult.errors.length}`,
          "cron",
        );
        if (syncResult.errors.length > 0) {
          log(`同步錯誤: ${syncResult.errors.slice(0, 10).join("; ")}`, "cron");
        }
      } catch (err: any) {
        log(`Ragic 同步失敗: ${err.message}`, "cron");
      }
    },
    { timezone: "Asia/Taipei" },
  );
  log("已排程每日凌晨 3:00 (台灣時間) 自動執行 Ragic 同步", "cron");

  // 19:00 daily — push tomorrow's shifts via LINE.
  cron.schedule(
    "0 19 * * *",
    async () => {
      log("開始執行明日班表推撥通知...", "cron");
      try {
        const result = await sendShiftReminders();
        log(
          `班表推撥完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`,
          "cron",
        );
      } catch (err: any) {
        log(`班表推撥失敗: ${err.message}`, "cron");
      }
    },
    { timezone: "Asia/Taipei" },
  );
  log("已排程每日 19:00 (台灣時間) 自動推撥明日班表", "cron");

  // Every 30 minutes between 06:00 and 21:30 — missing clock-in check.
  cron.schedule(
    "*/30 6-21 * * *",
    async () => {
      log("開始檢查未打卡員工...", "cron");
      try {
        const result = await checkMissingClockIn();
        log(
          `未打卡檢查完成: 通知 ${result.notified}, 跳過 ${result.skipped}`,
          "cron",
        );
      } catch (err: any) {
        log(`未打卡檢查失敗: ${err.message}`, "cron");
      }
    },
    { timezone: "Asia/Taipei" },
  );
  log("已排程每 30 分鐘（06:00-21:30）檢查未打卡員工", "cron");

  // 00:00 daily — reset in-memory tracker so notifications can fire again.
  cron.schedule(
    "0 0 * * *",
    () => {
      resetMissingClockInTracker();
    },
    { timezone: "Asia/Taipei" },
  );
  log("已排程每日午夜重置未打卡追蹤記錄", "cron");

  // Sunday 19:00 — push next-week schedule.
  cron.schedule(
    "0 19 * * 0",
    async () => {
      log("開始執行每週下週班表推播...", "cron");
      try {
        const result = await sendWeeklySchedulePush();
        log(
          `週班表推播完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`,
          "cron",
        );
      } catch (err: any) {
        log(`週班表推播失敗: ${err.message}`, "cron");
      }
    },
    { timezone: "Asia/Taipei" },
  );
  log("已排程每週日 19:00 (台灣時間) 自動推播下週班表", "cron");

  // Monday 09:00 — push last-week late report.
  cron.schedule(
    "0 9 * * 1",
    async () => {
      log("開始執行上週遲到報告推播...", "cron");
      try {
        const result = await sendWeeklyLateReport();
        log(
          `週遲到報告推播完成: 發送 ${result.sent}, 跳過 ${result.skipped}, 無LINE ${result.noLineId}`,
          "cron",
        );
      } catch (err: any) {
        log(`週遲到報告推播失敗: ${err.message}`, "cron");
      }
    },
    { timezone: "Asia/Taipei" },
  );
  log("已排程每週一 09:00 (台灣時間) 自動推播上週遲到報告", "cron");
}
