import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, date, time, serial, timestamp, real } from "drizzle-orm/pg-core";
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
  { name: "松山區", code: "B" },
  { name: "新竹區", code: "C" },
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
});

export const insertGuidelineSchema = createInsertSchema(guidelines).omit({ id: true, createdAt: true });
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

export type RegionCode = "A" | "B" | "C";

export interface ShiftValidationError {
  type: "seven_day_rest" | "daily_12h" | "rest_11h" | "inactive_employee";
  message: string;
  employeeId: number;
  date: string;
}

export interface VacancyInfo {
  venueId: number;
  venueName: string;
  timeSlot: string;
  required: number;
  assigned: number;
  shortage: number;
}
