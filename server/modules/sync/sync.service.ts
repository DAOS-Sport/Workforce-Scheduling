/**
 * Sync service — Ragic and LINE broadcast triggers exposed via HTTP.
 *
 * The implementations live in server/ragic.ts and server/line-webhook.ts;
 * this file is the single seam routes / cron / future internal-api should
 * call so the underlying functions can be moved without breaking callers.
 *
 * A trigger asks for the job to run, never for a second round: a push that was sent is not pushed again,
 * and one that failed is retried. While the same job is still running elsewhere the answer is `{ busy: true }`.
 */
import {
  sendShiftReminders,
  sendWeeklySchedulePush,
  sendWeeklyLateReport,
} from "../line/linePush.service";
import { runJob } from "../../shared/health/runJob";

type PushCounts = { sent: number; skipped: number; noLineId: number };
export type TriggerResult = PushCounts | { busy: true };

async function trigger(job: string, run: () => Promise<PushCounts>): Promise<TriggerResult> {
  const result = await runJob(job, "manual", run, (r) => ({ ...r }));
  return result.busy ? { busy: true } : result.value;
}

export const syncService = {
  shiftReminders: () => trigger("push.shift-reminders", sendShiftReminders),
  weeklySchedule: () => trigger("push.weekly-schedule", sendWeeklySchedulePush),
  weeklyLateReport: () => trigger("report.weekly-late", sendWeeklyLateReport),
};
