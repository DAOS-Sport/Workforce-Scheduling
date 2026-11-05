import { pool } from "../infra/db";
import { log } from "../shared/log";

async function ensureDispatchShiftsSoftDelete(): Promise<void> {
  await pool.query(`
    ALTER TABLE dispatch_shifts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE dispatch_shifts ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
    ALTER TABLE dispatch_shifts ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
    ALTER TABLE dispatch_shifts ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

    CREATE TABLE IF NOT EXISTS dispatch_shift_audit_log (
      id SERIAL PRIMARY KEY,
      dispatch_shift_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_dispatch_shift_audit ON dispatch_shift_audit_log (dispatch_shift_id);
    CREATE INDEX IF NOT EXISTS idx_dispatch_shifts_status ON dispatch_shifts (status);
  `);
  console.log("[db] dispatch_shifts soft-delete schema 確認完成");
}

async function ensureShiftsSoftDelete(): Promise<void> {
  await pool.query(`
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
    ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

    CREATE TABLE IF NOT EXISTS shift_audit_log (
      id SERIAL PRIMARY KEY,
      shift_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_shift_audit_shift ON shift_audit_log (shift_id);
    CREATE INDEX IF NOT EXISTS idx_shift_audit_created ON shift_audit_log (created_at);
    CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts (status);
  `);
  console.log("[db] shifts soft-delete schema 確認完成");
}

async function ensureAnnouncementsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      target_region TEXT,
      published_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP,
      created_by INTEGER
    )
  `);
  console.log("[db] announcements 表格確認完成");
}

async function ensureLeaveRequestsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT,
      certificate_image_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_by_name TEXT,
      reviewed_at TIMESTAMP,
      review_note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log("[db] leave_requests 表格確認完成");
}

async function ensureLeaveManagementTables(): Promise<void> {
  await pool.query(`
    ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_time TEXT;
    ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_time TEXT;
    ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hours REAL;

    CREATE TABLE IF NOT EXISTS employee_leave_balances (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      total_hours REAL NOT NULL DEFAULT 0,
      used_hours REAL NOT NULL DEFAULT 0,
      pending_hours REAL NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT elb_uniq_emp_year UNIQUE (employee_id, year)
    );

    CREATE TABLE IF NOT EXISTS leave_balance_logs (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      leave_request_id INTEGER,
      operated_by INTEGER,
      operated_by_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_elb_emp_year ON employee_leave_balances (employee_id, year);
    CREATE INDEX IF NOT EXISTS idx_lbl_emp_year ON leave_balance_logs (employee_id, year);
  `);
  console.log("[db] leave_management 表格確認完成");
}

async function ensureOutingRecordsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outing_records (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      out_type TEXT NOT NULL,
      destination TEXT,
      note TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'submitted',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log("[db] outing_records 表格確認完成");
}

async function ensureShiftAvailabilitiesTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shift_availabilities (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_shift_avail_emp_date ON shift_availabilities (employee_id, date);
  `);
  console.log("[db] shift_availabilities 表格確認完成");
}

async function ensureAvailabilityEntryTypeColumn(): Promise<void> {
  await pool.query(`
    ALTER TABLE shift_availabilities ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'available';
    ALTER TABLE shift_availabilities ALTER COLUMN start_time DROP NOT NULL;
    ALTER TABLE shift_availabilities ALTER COLUMN end_time DROP NOT NULL;
  `);
  console.log("[db] shift_availabilities entry_type 欄位確認完成");
}

async function ensureVenueOperatingHoursColumns(): Promise<void> {
  await pool.query(`
    ALTER TABLE venues ADD COLUMN IF NOT EXISTS open_time TEXT;
    ALTER TABLE venues ADD COLUMN IF NOT EXISTS close_time TEXT;
  `);
  console.log("[db] venues open_time/close_time 欄位確認完成");
}

async function ensureSummerAvailabilitiesTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS summer_availabilities (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      week_no INTEGER NOT NULL,
      venue_names JSONB NOT NULL DEFAULT '[]',
      weekday_days JSONB NOT NULL DEFAULT '[]',
      weekday_slots JSONB NOT NULL DEFAULT '[]',
      sat_slots JSONB NOT NULL DEFAULT '[]',
      sun_slots JSONB NOT NULL DEFAULT '[]',
      notes TEXT,
      submitted_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT sa_uniq_emp_week UNIQUE (employee_id, week_no)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_summer_avail_week ON summer_availabilities (week_no);
  `);
  console.log("[db] summer_availabilities 表格確認完成");
}

async function ensureWeeklyPushTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weekly_push_notifications (
      id SERIAL PRIMARY KEY,
      week_start_date TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      push_type TEXT NOT NULL,
      sent_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'wpn_uniq_week_emp_type'
      ) THEN
        ALTER TABLE weekly_push_notifications
        ADD CONSTRAINT wpn_uniq_week_emp_type
        UNIQUE (week_start_date, employee_id, push_type);
      END IF;
    END $$
  `);
}

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

  // Leave management tables (balances + logs + new columns)
  try {
    await ensureLeaveManagementTables();
    log("leave_management 表格確認完成", "db");
  } catch (err: any) {
    log(`leave_management 表格建立失敗: ${err.message}`, "db");
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

  // Venue operating hours columns (open_time, close_time)
  try {
    await ensureVenueOperatingHoursColumns();
  } catch (err: any) {
    log(`venues open_time/close_time 欄位建立失敗: ${err.message}`, "db");
  }

  // Summer availabilities table (Task #108)
  try {
    await ensureSummerAvailabilitiesTable();
    log("summer_availabilities 表格確認完成", "db");
  } catch (err: any) {
    log(`summer_availabilities 表格建立失敗: ${err.message}`, "db");
  }
}
