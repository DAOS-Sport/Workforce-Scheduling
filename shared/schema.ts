import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, date, time, serial, timestamp, real, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const regions = pgTable("regions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
});

export const insertRegionSchema = createInsertSchema(regions).omit({ id: true });
export type InsertRegion = z.infer<typeof insertRegionSchema>;
export type Region = typeof regions.$inferSelect;

export const venues = pgTable("venues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  regionId: integer("region_id").notNull(),
  address: text("address"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  radius: integer("radius").default(100),
  taxId: text("tax_id"),
  isInternal: boolean("is_internal").default(false),
  operationType: text("operation_type"),
});

export const insertVenueSchema = createInsertSchema(venues).omit({ id: true });
export type InsertVenue = z.infer<typeof insertVenueSchema>;
export type Venue = typeof venues.$inferSelect;

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  employeeCode: text("employee_code").notNull().unique(),
  phone: text("phone"),
  email: text("email"),
  lineId: text("line_id"),
  regionId: integer("region_id").notNull(),
  status: text("status").notNull().default("active"),
  role: text("role").notNull().default("pt"),
  employmentType: text("employment_type").notNull().default("full_time"),
  isAdmin: boolean("is_admin").default(false),
  department: text("department"),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  venueId: integer("venue_id").notNull(),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  role: text("role").notNull().default("救生"),
  isDispatch: boolean("is_dispatch").default(false),
  dispatchCompany: text("dispatch_company"),
  dispatchName: text("dispatch_name"),
  dispatchPhone: text("dispatch_phone"),
  certificateImageUrl: text("certificate_image_url"),
});

export const insertShiftSchema = createInsertSchema(shifts).omit({ id: true });
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shifts.$inferSelect;

export const venueRequirements = pgTable("venue_requirements", {
  id: serial("id").primaryKey(),
  venueId: integer("venue_id").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  requiredCount: integer("required_count").notNull().default(1),
});

export const insertVenueRequirementSchema = createInsertSchema(venueRequirements).omit({ id: true });
export type InsertVenueRequirement = z.infer<typeof insertVenueRequirementSchema>;
export type VenueRequirement = typeof venueRequirements.$inferSelect;

export const scheduleSlots = pgTable("schedule_slots", {
  id: serial("id").primaryKey(),
  venueId: integer("venue_id").notNull(),
  date: date("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  role: text("role").notNull().default("救生"),
  requiredCount: integer("required_count").notNull().default(1),
});

export const insertScheduleSlotSchema = createInsertSchema(scheduleSlots).omit({ id: true });
export type InsertScheduleSlot = z.infer<typeof insertScheduleSlotSchema>;
export type ScheduleSlot = typeof scheduleSlots.$inferSelect;

export const venueShiftTemplates = pgTable("venue_shift_templates", {
  id: serial("id").primaryKey(),
  venueId: integer("venue_id").notNull(),
  dayType: text("day_type").notNull(),
  shiftLabel: text("shift_label").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  role: text("role").notNull(),
  requiredCount: integer("required_count").notNull().default(1),
});

export const insertVenueShiftTemplateSchema = createInsertSchema(venueShiftTemplates).omit({ id: true });
export type InsertVenueShiftTemplate = z.infer<typeof insertVenueShiftTemplateSchema>;
export type VenueShiftTemplate = typeof venueShiftTemplates.$inferSelect;

export const REGIONS_DATA = [
  { name: "三蘆戰區", code: "A" },
  { name: "松山國小", code: "B" },
  { name: "新竹區", code: "C" },
  { name: "內勤", code: "D" },
] as const;

export const VENUES_DATA = [
  { name: "三重商工館", shortName: "三重商工", regionCode: "A" },
  { name: "新北高中館", shortName: "新北高中", regionCode: "A" },
  { name: "三民高中館", shortName: "三民高中", regionCode: "A" },
  { name: "松山國小館", shortName: "松山國小", regionCode: "B" },
  { name: "新竹科學園區", shortName: "新竹科園", regionCode: "C" },
] as const;

export const attendanceUploads = pgTable("attendance_uploads", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  totalRecords: integer("total_records").default(0),
});

export const insertAttendanceUploadSchema = createInsertSchema(attendanceUploads).omit({ id: true, uploadedAt: true });
export type InsertAttendanceUpload = z.infer<typeof insertAttendanceUploadSchema>;
export type AttendanceUpload = typeof attendanceUploads.$inferSelect;

export const attendanceRecords = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  uploadId: integer("upload_id").notNull(),
  employeeCode: text("employee_code").notNull(),
  employeeName: text("employee_name").notNull(),
  department: text("department"),
  date: date("date").notNull(),
  dayType: text("day_type"),
  shiftType: text("shift_type"),
  scheduledStart: text("scheduled_start"),
  scheduledEnd: text("scheduled_end"),
  clockIn: text("clock_in"),
  clockOut: text("clock_out"),
  isLate: boolean("is_late").default(false),
  isEarlyLeave: boolean("is_early_leave").default(false),
  hasAnomaly: boolean("has_anomaly").default(false),
  anomalyNote: text("anomaly_note"),
  leaveHours: text("leave_hours"),
  leaveType: text("leave_type"),
  overtimeHours: text("overtime_hours"),
  clockInMethod: text("clock_in_method"),
  clockInLocation: text("clock_in_location"),
  clockOutMethod: text("clock_out_method"),
  clockOutLocation: text("clock_out_location"),
});

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({ id: true });
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;

export const guidelines = pgTable("guidelines", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  contentType: text("content_type").notNull().default("text"),
  videoUrl: text("video_url"),
  venueId: integer("venue_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  yearMonth: text("year_month"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGuidelineSchema = createInsertSchema(guidelines).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGuideline = z.infer<typeof insertGuidelineSchema>;
export type Guideline = typeof guidelines.$inferSelect;

export const guidelineAcknowledgments = pgTable("guideline_acknowledgments", {
  id: serial("id").primaryKey(),
  guidelineId: integer("guideline_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  acknowledgedAt: timestamp("acknowledged_at").defaultNow(),
});

export const insertGuidelineAckSchema = createInsertSchema(guidelineAcknowledgments).omit({ id: true, acknowledgedAt: true });
export type InsertGuidelineAck = z.infer<typeof insertGuidelineAckSchema>;
export type GuidelineAck = typeof guidelineAcknowledgments.$inferSelect;

export const clockRecords = pgTable("clock_records", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  venueId: integer("venue_id"),
  shiftId: integer("shift_id"),
  clockType: text("clock_type").notNull().default("in"),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  distance: real("distance"),
  status: text("status").notNull().default("success"),
  failReason: text("fail_reason"),
  clockTime: timestamp("clock_time").defaultNow(),
  matchedVenueName: text("matched_venue_name"),
  earlyArrivalReason: text("early_arrival_reason"),
  lateDepartureReason: text("late_departure_reason"),
});

export const insertClockRecordSchema = createInsertSchema(clockRecords).omit({ id: true });
export type InsertClockRecord = z.infer<typeof insertClockRecordSchema>;
export type ClockRecord = typeof clockRecords.$inferSelect;

export const clockAmendments = pgTable("clock_amendments", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  shiftId: integer("shift_id"),
  venueId: integer("venue_id"),
  clockType: text("clock_type").notNull(),
  requestedTime: timestamp("requested_time").notNull(),
  reason: text("reason").notNull(),
  isSystemIssue: boolean("is_system_issue").notNull().default(false),
  evidenceImageUrl: text("evidence_image_url"),
  status: text("status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by"),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertClockAmendmentSchema = createInsertSchema(clockAmendments).omit({ id: true, createdAt: true, reviewedAt: true });
export type InsertClockAmendment = z.infer<typeof insertClockAmendmentSchema>;
export type ClockAmendment = typeof clockAmendments.$inferSelect;

export const overtimeRequests = pgTable("overtime_requests", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  reason: text("reason").notNull(),
  evidenceImageUrl: text("evidence_image_url"),
  status: text("status").notNull().default("pending"),
  source: text("source").notNull().default("manual"),
  clockRecordId: integer("clock_record_id"),
  reviewedBy: integer("reviewed_by"),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOvertimeRequestSchema = createInsertSchema(overtimeRequests).omit({ id: true, createdAt: true, reviewedAt: true });
export type InsertOvertimeRequest = z.infer<typeof insertOvertimeRequestSchema>;
export type OvertimeRequest = typeof overtimeRequests.$inferSelect;

export const dispatchShifts = pgTable("dispatch_shifts", {
  id: serial("id").primaryKey(),
  regionId: integer("region_id").notNull(),
  venueId: integer("venue_id"),
  date: date("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  dispatchName: text("dispatch_name").notNull(),
  dispatchCompany: text("dispatch_company"),
  dispatchPhone: text("dispatch_phone"),
  role: text("role").notNull().default("救生"),
  notes: text("notes"),
  linkedEmployeeId: integer("linked_employee_id"),
});

export const insertDispatchShiftSchema = createInsertSchema(dispatchShifts).omit({ id: true });
export type InsertDispatchShift = z.infer<typeof insertDispatchShiftSchema>;
export type DispatchShift = typeof dispatchShifts.$inferSelect;

export const anomalyReports = pgTable("anomaly_reports", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id"),
  employeeName: text("employee_name"),
  employeeCode: text("employee_code"),
  role: text("role"),
  lineUserId: text("line_user_id"),
  context: text("context").notNull(),
  clockStatus: text("clock_status"),
  clockType: text("clock_type"),
  clockTime: text("clock_time"),
  venueName: text("venue_name"),
  distance: text("distance"),
  failReason: text("fail_reason"),
  errorMsg: text("error_msg"),
  userNote: text("user_note"),
  imageUrls: text("image_urls").array(),
  reportText: text("report_text").notNull(),
  resolution: text("resolution").default("pending"),
  resolvedNote: text("resolved_note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAnomalyReportSchema = createInsertSchema(anomalyReports).omit({ id: true, createdAt: true });
export type InsertAnomalyReport = z.infer<typeof insertAnomalyReportSchema>;
export type AnomalyReport = typeof anomalyReports.$inferSelect;

export const salaryRateConfigs = pgTable("salary_rate_configs", {
  id: serial("id").primaryKey(),
  role: text("role").notNull().unique(),
  ratePerHour: real("rate_per_hour").notNull().default(0),
  label: text("label"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSalaryRateConfigSchema = createInsertSchema(salaryRateConfigs).omit({ id: true, updatedAt: true });
export type InsertSalaryRateConfig = z.infer<typeof insertSalaryRateConfigSchema>;
export type SalaryRateConfig = typeof salaryRateConfigs.$inferSelect;

export const notificationRecipients = pgTable("notification_recipients", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  label: text("label"),
  enabled: boolean("enabled").default(true),
  notifyNewReport: boolean("notify_new_report").default(true),
  notifyResolution: boolean("notify_resolution").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNotificationRecipientSchema = createInsertSchema(notificationRecipients).omit({ id: true, createdAt: true });
export type InsertNotificationRecipient = z.infer<typeof insertNotificationRecipientSchema>;
export type NotificationRecipient = typeof notificationRecipients.$inferSelect;

export const systemConfigs = pgTable("system_configs", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSystemConfigSchema = createInsertSchema(systemConfigs).omit({ id: true, updatedAt: true });
export type InsertSystemConfig = z.infer<typeof insertSystemConfigSchema>;
export type SystemConfig = typeof systemConfigs.$inferSelect;

export type RegionCode = "D" | "A" | "B" | "C";

export interface ShiftValidationError {
  type: "seven_day_rest" | "daily_12h" | "rest_11h" | "inactive_employee" | "four_week_160h" | "four_week_176h";
  message: string;
  employeeId: number;
  date: string;
}

export function getFourWeekPeriod(dateStr: string, referenceDateStr: string): { start: string; end: string } {
  const refDate = new Date(referenceDateStr + "T00:00:00Z");
  const targetDate = new Date(dateStr + "T00:00:00Z");
  const diffMs = targetDate.getTime() - refDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const periodLength = 28;
  const periodIndex = diffDays >= 0
    ? Math.floor(diffDays / periodLength)
    : -Math.ceil((-diffDays) / periodLength);
  const periodStartMs = refDate.getTime() + periodIndex * periodLength * 24 * 60 * 60 * 1000;
  const periodStart = new Date(periodStartMs);
  const periodEnd = new Date(periodStartMs + (periodLength - 1) * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { start: fmt(periodStart), end: fmt(periodEnd) };
}

export function calcShiftHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return (endMin - startMin) / 60;
}

export function sumScheduledHours(
  shifts: { startTime: string; endTime: string; role: string; employeeId: number; date: string }[],
  employeeId: number,
  periodStart: string,
  periodEnd: string,
  leaveTypes: string[]
): number {
  let total = 0;
  for (const s of shifts) {
    if (s.employeeId !== employeeId) continue;
    if (s.date < periodStart || s.date > periodEnd) continue;
    if (leaveTypes.includes(s.role)) continue;
    total += calcShiftHours(s.startTime, s.endTime);
  }
  return Math.round(total * 10) / 10;
}

export function getAllPeriodsForMonth(year: number, month: number, referenceDate: string): { start: string; end: string }[] {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const seen = new Set<string>();
  const periods: { start: string; end: string }[] = [];

  let current = monthStart;
  while (current <= monthEnd) {
    const period = getFourWeekPeriod(current, referenceDate);
    const key = period.start;
    if (!seen.has(key)) {
      seen.add(key);
      periods.push(period);
    }
    const d = new Date(current + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    current = d.toISOString().split("T")[0];
    if (seen.has(getFourWeekPeriod(current, referenceDate).start) && current <= monthEnd) {
      const nextPeriod = getFourWeekPeriod(current, referenceDate);
      const jumpTo = new Date(nextPeriod.end + "T00:00:00Z");
      jumpTo.setUTCDate(jumpTo.getUTCDate() + 1);
      current = jumpTo.toISOString().split("T")[0];
    }
  }

  return periods;
}

// Tracks which employee+shift combos have already received a "missing clock-in" LINE push today.
// Stored in DB so it survives server restarts.
export const missingClockNotifications = pgTable("missing_clock_notifications", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),          // YYYY-MM-DD (Taiwan)
  employeeId: integer("employee_id").notNull(),
  shiftId: integer("shift_id").notNull(),
  notifiedAt: timestamp("notified_at").defaultNow(),
});

export const insertMissingClockNotificationSchema = createInsertSchema(missingClockNotifications).omit({ id: true, notifiedAt: true });
export type InsertMissingClockNotification = z.infer<typeof insertMissingClockNotificationSchema>;
export type MissingClockNotification = typeof missingClockNotifications.$inferSelect;

// Deduplication table for weekly LINE pushes (schedule + late report).
// Keyed by week_start_date (YYYY-MM-DD of Monday) + employee_id + push_type.
export const weeklyPushNotifications = pgTable("weekly_push_notifications", {
  id: serial("id").primaryKey(),
  weekStartDate: text("week_start_date").notNull(),  // YYYY-MM-DD (Monday)
  employeeId: integer("employee_id").notNull(),
  pushType: text("push_type").notNull(),              // 'schedule' | 'late_report'
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => ({
  uniq: unique("wpn_uniq_week_emp_type").on(t.weekStartDate, t.employeeId, t.pushType),
}));

export const insertWeeklyPushNotificationSchema = createInsertSchema(weeklyPushNotifications).omit({ id: true, sentAt: true });
export type InsertWeeklyPushNotification = z.infer<typeof insertWeeklyPushNotificationSchema>;
export type WeeklyPushNotification = typeof weeklyPushNotifications.$inferSelect;

export const leaveRequests = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  leaveType: text("leave_type").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  reason: text("reason"),
  certificateImageUrl: text("certificate_image_url"),
  status: text("status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by"),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLeaveRequestSchema = createInsertSchema(leaveRequests).omit({ id: true, createdAt: true, reviewedAt: true });
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;
export type LeaveRequest = typeof leaveRequests.$inferSelect;

export interface VacancyInfo {
  venueId: number;
  venueName: string;
  timeSlot: string;
  required: number;
  assigned: number;
  shortage: number;
}
