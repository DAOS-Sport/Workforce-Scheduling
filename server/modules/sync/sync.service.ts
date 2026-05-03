/**
 * Sync service — Ragic and LINE broadcast triggers exposed via HTTP.
 *
 * The implementations live in server/ragic.ts and server/line-webhook.ts;
 * this file is the single seam routes / cron / future internal-api should
 * call so the underlying functions can be moved without breaking callers.
 */
import { syncFromRagic, syncVenuesFromRagic } from "../ragic/ragic.service";
import {
  sendShiftReminders,
  sendWeeklySchedulePush,
  sendWeeklyLateReport,
} from "../line/linePush.service";

export const syncService = {
  ragicVenues: () => syncVenuesFromRagic(),
  ragicAll: () => syncFromRagic(),
  shiftReminders: (force = false) => sendShiftReminders(force),
  weeklySchedule: (force = false) => sendWeeklySchedulePush(force),
  weeklyLateReport: (force = false) => sendWeeklyLateReport(force),
};
