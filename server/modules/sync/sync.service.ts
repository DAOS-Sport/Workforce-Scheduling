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
import { trackJob } from "../../shared/health/healthState";

export const syncService = {
  ragicVenues: () => syncVenuesFromRagic(),
  ragicAll: () => trackJob("ragic.sync", "manual", () => syncFromRagic(), (r) => ({ created: r.created, updated: r.updated, deactivated: r.deactivated, skipped: r.skipped, errors: r.errors.length })),
  shiftReminders: (force = false) => trackJob("push.shift-reminders", "manual", () => sendShiftReminders(force), (r) => ({ ...r })),
  weeklySchedule: (force = false) => trackJob("push.weekly-schedule", "manual", () => sendWeeklySchedulePush(force), (r) => ({ ...r })),
  weeklyLateReport: (force = false) => trackJob("report.weekly-late", "manual", () => sendWeeklyLateReport(force), (r) => ({ ...r })),
};
