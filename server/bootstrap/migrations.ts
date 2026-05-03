import {
  ensureWeeklyPushTable,
  ensureLeaveRequestsTable,
  ensureAnnouncementsTable,
  ensureShiftsSoftDelete,
  ensureOutingRecordsTable,
} from "../storage";
import { log } from "../shared/log";

/**
 * Run every idempotent "ensure schema" function on boot. Failures are
 * logged but do NOT prevent the server from starting (mirrors the old
 * try/catch-per-step behaviour of the original index.ts).
 */
export async function runStartupMigrations(): Promise<void> {
  // Weekly push notification dedup table
  try {
    await ensureWeeklyPushTable();
    log("weekly_push_notifications 表格確認完成", "db");
  } catch (err: any) {
    log(`weekly_push_notifications 表格建立失敗: ${err.message}`, "db");
  }

  // Leave requests table
  try {
    await ensureLeaveRequestsTable();
  } catch (err: any) {
    log(`leave_requests 表格建立失敗: ${err.message}`, "db");
  }

  // Shift soft-delete columns + shift_audit_log table (Task #50 protection)
  try {
    await ensureShiftsSoftDelete();
  } catch (err: any) {
    log(`shifts soft-delete schema 建立失敗: ${err.message}`, "db");
  }

  // Announcements table
  try {
    await ensureAnnouncementsTable();
  } catch (err: any) {
    log(`announcements 表格建立失敗: ${err.message}`, "db");
  }

  // Outing records table
  try {
    await ensureOutingRecordsTable();
  } catch (err: any) {
    log(`outing_records 表格建立失敗: ${err.message}`, "db");
  }
}
