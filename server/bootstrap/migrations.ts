import {
  ensureWeeklyPushTable,
  ensureLeaveRequestsTable,
  ensureAnnouncementsTable,
  ensureShiftsSoftDelete,
  ensureDispatchShiftsSoftDelete,
  ensureOutingRecordsTable,
  ensureShiftAvailabilitiesTable,
  ensureAvailabilityEntryTypeColumn,
  ensureAvailabilityLeaveTypeColumn,
  ensureVenueOperatingHoursColumns,
} from "../storage";
import { log } from "../shared/log";
import { pool } from "../infra/db";

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

  // Dispatch shift soft-delete columns + dispatch_shift_audit_log table (Task #55)
  try {
    await ensureDispatchShiftsSoftDelete();
  } catch (err: any) {
    log(`dispatch_shifts soft-delete schema 建立失敗: ${err.message}`, "db");
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

  // Shift availabilities table
  try {
    await ensureShiftAvailabilitiesTable();
  } catch (err: any) {
    log(`shift_availabilities 表格建立失敗: ${err.message}`, "db");
  }

  // Shift availabilities entry_type column + nullable start/end times (Task #84)
  try {
    await ensureAvailabilityEntryTypeColumn();
  } catch (err: any) {
    log(`shift_availabilities entry_type 欄位建立失敗: ${err.message}`, "db");
  }

  // Shift availabilities leave_type column + data migration from note field
  try {
    await ensureAvailabilityLeaveTypeColumn();
    log("shift_availabilities leave_type 欄位確認完成", "db");
  } catch (err: any) {
    log(`shift_availabilities leave_type 欄位建立失敗: ${err.message}`, "db");
  }

  // Venue operating hours columns (open_time, close_time)
  try {
    await ensureVenueOperatingHoursColumns();
  } catch (err: any) {
    log(`venues open_time/close_time 欄位建立失敗: ${err.message}`, "db");
  }

  // Observability tables (Task #97)
  try {
    await ensureObservabilityTables();
    log("observability 表格確認完成", "db");
  } catch (err: any) {
    log(`observability 表格建立失敗: ${err.message}`, "db");
  }
}

async function ensureObservabilityTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_logs (
        id          SERIAL PRIMARY KEY,
        timestamp   TIMESTAMP NOT NULL DEFAULT NOW(),
        level       TEXT NOT NULL,
        service     TEXT NOT NULL,
        environment TEXT NOT NULL,
        module      TEXT,
        action      TEXT,
        request_id  TEXT,
        route       TEXT,
        method      TEXT,
        status_code INTEGER,
        duration_ms INTEGER,
        error_code  TEXT,
        error_message TEXT,
        external_service TEXT,
        safe_context JSONB,
        message     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_logs_timestamp_idx  ON app_logs (timestamp DESC);
      CREATE INDEX IF NOT EXISTS app_logs_level_idx      ON app_logs (level);
      CREATE INDEX IF NOT EXISTS app_logs_request_id_idx ON app_logs (request_id);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id            SERIAL PRIMARY KEY,
        timestamp     TIMESTAMP NOT NULL DEFAULT NOW(),
        request_id    TEXT,
        actor_user_id TEXT,
        actor_role    TEXT,
        action        TEXT NOT NULL,
        target_type   TEXT,
        target_id     TEXT,
        before_state  JSONB,
        after_state   JSONB,
        message       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON audit_logs (timestamp DESC);
      CREATE INDEX IF NOT EXISTS audit_logs_actor_idx     ON audit_logs (actor_user_id);

      CREATE TABLE IF NOT EXISTS user_error_events (
        id                  SERIAL PRIMARY KEY,
        timestamp           TIMESTAMP NOT NULL DEFAULT NOW(),
        request_id          TEXT,
        user_id             TEXT,
        user_role           TEXT,
        action              TEXT,
        error_code          TEXT,
        message_shown       TEXT,
        route               TEXT,
        form_state_snapshot JSONB
      );
      CREATE INDEX IF NOT EXISTS user_error_events_timestamp_idx ON user_error_events (timestamp DESC);
    `);
  } finally {
    client.release();
  }
}
