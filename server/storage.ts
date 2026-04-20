import { db, pool } from "./db";
import { eq, and, gte, lte, inArray, desc, or, isNull } from "drizzle-orm";
import {
  regions, venues, employees, shifts, shiftAuditLog, venueRequirements,
  scheduleSlots, venueShiftTemplates,
  attendanceUploads, attendanceRecords,
  guidelines, guidelineAcknowledgments,
  clockRecords,
  clockAmendments,
  overtimeRequests,
  dispatchShifts,
  anomalyReports,
  notificationRecipients,
  salaryRateConfigs,
  systemConfigs,
  missingClockNotifications,
  weeklyPushNotifications,
  leaveRequests,
  type Region, type InsertRegion,
  type Venue, type InsertVenue,
  type Employee, type InsertEmployee,
  type Shift, type InsertShift,
  type VenueRequirement, type InsertVenueRequirement,
  type ScheduleSlot, type InsertScheduleSlot,
  type VenueShiftTemplate, type InsertVenueShiftTemplate,
  type AttendanceUpload, type InsertAttendanceUpload,
  type AttendanceRecord, type InsertAttendanceRecord,
  type Guideline, type InsertGuideline,
  type GuidelineAck, type InsertGuidelineAck,
  type ClockRecord, type InsertClockRecord,
  type ClockAmendment, type InsertClockAmendment,
  type OvertimeRequest, type InsertOvertimeRequest,
  type DispatchShift, type InsertDispatchShift,
  type AnomalyReport, type InsertAnomalyReport,
  type NotificationRecipient, type InsertNotificationRecipient,
  type SalaryRateConfig,
  type SystemConfig,
  type MissingClockNotification,
  type WeeklyPushNotification,
  type LeaveRequest, type InsertLeaveRequest,
  type ShiftAuditLog,
} from "@shared/schema";

export interface IStorage {
  getRegions(): Promise<Region[]>;
  getRegionByCode(code: string): Promise<Region | undefined>;
  createRegion(data: InsertRegion): Promise<Region>;

  getVenuesByRegion(regionId: number): Promise<Venue[]>;
  getAllVenues(): Promise<Venue[]>;
  getVenue(id: number): Promise<Venue | undefined>;
  createVenue(data: InsertVenue): Promise<Venue>;
  updateVenue(id: number, data: Partial<InsertVenue>): Promise<Venue | undefined>;

  getEmployeesByRegion(regionId: number): Promise<Employee[]>;
  getEmployeesForNeiQin(regionId: number): Promise<Employee[]>;
  getAllEmployees(): Promise<Employee[]>;
  getEmployee(id: number): Promise<Employee | undefined>;
  getEmployeeByCode(code: string): Promise<Employee | undefined>;
  createEmployee(data: InsertEmployee): Promise<Employee>;
  updateEmployee(id: number, data: Partial<InsertEmployee>): Promise<Employee | undefined>;

  getShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<Shift[]>;
  getDispatchedShiftsToRegion(regionId: number, startDate: string, endDate: string): Promise<Shift[]>;
  getShiftsByDate(date: string): Promise<Shift[]>;
  getAllShiftsByDateRange(startDate: string, endDate: string): Promise<Shift[]>;
  getShiftsByEmployee(employeeId: number): Promise<Shift[]>;
  getShiftsByEmployeesAndDateRange(employeeIds: number[], startDate: string, endDate: string): Promise<Shift[]>;
  getShift(id: number): Promise<Shift | undefined>;
  createShift(data: InsertShift): Promise<Shift>;
  updateShift(id: number, data: Partial<InsertShift>): Promise<Shift | undefined>;
  deleteShift(id: number): Promise<boolean>;

  getVenueRequirementsByRegion(regionId: number): Promise<VenueRequirement[]>;
  createVenueRequirement(data: InsertVenueRequirement): Promise<VenueRequirement>;

  getScheduleSlotsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<ScheduleSlot[]>;
  getScheduleSlotsByVenueAndDate(venueId: number, date: string): Promise<ScheduleSlot[]>;
  createScheduleSlot(data: InsertScheduleSlot): Promise<ScheduleSlot>;
  updateScheduleSlot(id: number, data: Partial<InsertScheduleSlot>): Promise<ScheduleSlot | undefined>;
  deleteScheduleSlot(id: number): Promise<boolean>;

  getVenueShiftTemplates(venueId: number): Promise<VenueShiftTemplate[]>;
  createVenueShiftTemplate(data: InsertVenueShiftTemplate): Promise<VenueShiftTemplate>;
  deleteVenueShiftTemplate(id: number): Promise<boolean>;
  deleteVenueShiftTemplatesByVenue(venueId: number): Promise<void>;

  getAttendanceUploads(): Promise<AttendanceUpload[]>;
  createAttendanceUpload(data: InsertAttendanceUpload): Promise<AttendanceUpload>;
  updateAttendanceUpload(id: number, data: Partial<InsertAttendanceUpload>): Promise<AttendanceUpload | undefined>;
  deleteAttendanceUpload(id: number): Promise<boolean>;
  createAttendanceRecords(records: InsertAttendanceRecord[]): Promise<AttendanceRecord[]>;
  getAttendanceRecordsByUpload(uploadId: number): Promise<AttendanceRecord[]>;
  getAttendanceRecordsByDateRange(startDate: string, endDate: string, employeeCodes?: string[]): Promise<AttendanceRecord[]>;
  deleteAttendanceRecordsByUpload(uploadId: number): Promise<void>;

  getGuidelines(category?: string): Promise<Guideline[]>;
  getGuideline(id: number): Promise<Guideline | undefined>;
  createGuideline(data: InsertGuideline): Promise<Guideline>;
  updateGuideline(id: number, data: Partial<InsertGuideline>): Promise<Guideline | undefined>;
  deleteGuideline(id: number): Promise<boolean>;

  getGuidelineAcks(guidelineId: number): Promise<GuidelineAck[]>;
  createGuidelineAck(data: InsertGuidelineAck): Promise<GuidelineAck>;
  getGuidelineAcksByEmployee(employeeId: number): Promise<GuidelineAck[]>;

  getEmployeeByLineId(lineId: string): Promise<Employee | undefined>;
  getShiftsByEmployeeAndDateRange(employeeId: number, startDate: string, endDate: string): Promise<Shift[]>;
  getShiftsByVenueAndDate(venueId: number, date: string): Promise<Shift[]>;
  getCoworkersByVenueAndDate(venueId: number, date: string, excludeEmployeeId: number): Promise<Employee[]>;

  deleteEmployee(id: number): Promise<boolean>;

  getAllVenues(): Promise<Venue[]>;
  createClockRecord(data: InsertClockRecord): Promise<ClockRecord>;
  getClockRecord(id: number): Promise<ClockRecord | undefined>;
  getClockRecordsByDateRange(startDate: string, endDate: string): Promise<ClockRecord[]>;
  getClockRecordsByEmployee(employeeId: number, startDate: string, endDate: string): Promise<ClockRecord[]>;

  createClockAmendment(data: InsertClockAmendment): Promise<ClockAmendment>;
  getClockAmendments(status?: string): Promise<ClockAmendment[]>;
  getClockAmendmentsByEmployee(employeeId: number): Promise<ClockAmendment[]>;
  getClockAmendment(id: number): Promise<ClockAmendment | undefined>;
  updateClockAmendmentStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<ClockAmendment | undefined>;

  updateClockRecordReason(id: number, earlyArrivalReason?: string, lateDepartureReason?: string): Promise<ClockRecord | undefined>;

  createDispatchShift(data: InsertDispatchShift): Promise<DispatchShift>;
  batchCreateDispatchShifts(data: InsertDispatchShift[]): Promise<DispatchShift[]>;
  getDispatchShifts(regionId: number, startDate: string, endDate: string): Promise<DispatchShift[]>;
  getDispatchShiftsByDate(date: string): Promise<DispatchShift[]>;
  getDispatchShiftsByLinkedEmployee(employeeId: number, startDate: string, endDate: string): Promise<DispatchShift[]>;
  getDispatchShift(id: number): Promise<DispatchShift | undefined>;
  updateDispatchShift(id: number, data: Partial<InsertDispatchShift>): Promise<DispatchShift | undefined>;
  deleteDispatchShift(id: number): Promise<void>;
  reconcileDispatchLinks(): Promise<number>;

  createOvertimeRequest(data: InsertOvertimeRequest): Promise<OvertimeRequest>;
  getOvertimeRequests(status?: string): Promise<OvertimeRequest[]>;
  getOvertimeRequestsByEmployee(employeeId: number): Promise<OvertimeRequest[]>;
  getOvertimeRequest(id: number): Promise<OvertimeRequest | undefined>;
  updateOvertimeRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<OvertimeRequest | undefined>;
  getOvertimeRequestsByEmployeeAndDate(employeeId: number, date: string): Promise<OvertimeRequest[]>;
  getApprovedOvertimeByDateRange(startDate: string, endDate: string): Promise<OvertimeRequest[]>;

  createAnomalyReport(data: InsertAnomalyReport): Promise<AnomalyReport>;
  getAnomalyReports(): Promise<AnomalyReport[]>;
  getAnomalyReport(id: number): Promise<AnomalyReport | undefined>;
  updateAnomalyResolution(id: number, resolution: string, resolvedNote?: string): Promise<AnomalyReport | undefined>;
  deleteAnomalyReport(id: number): Promise<void>;

  getNotificationRecipients(): Promise<NotificationRecipient[]>;
  createNotificationRecipient(data: InsertNotificationRecipient): Promise<NotificationRecipient>;
  updateNotificationRecipient(id: number, data: Partial<InsertNotificationRecipient>): Promise<NotificationRecipient | undefined>;
  deleteNotificationRecipient(id: number): Promise<void>;

  getSalaryRates(): Promise<SalaryRateConfig[]>;
  upsertSalaryRate(role: string, ratePerHour: number, label?: string): Promise<SalaryRateConfig>;

  getSystemConfig(key: string): Promise<SystemConfig | undefined>;
  upsertSystemConfig(key: string, value: string): Promise<SystemConfig>;

  // Missing clock-in notification tracking (persisted in DB so restarts don't cause re-sends)
  hasMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<boolean>;
  createMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<void>;
  clearOldMissingClockNotifications(beforeDate: string): Promise<void>;
  getMissingClockNotificationsForDate(date: string): Promise<MissingClockNotification[]>;

  // Weekly push notification deduplication
  hasWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string): Promise<boolean>;
  createWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string): Promise<void>;
  clearOldWeeklyPushNotifications(beforeWeekStart: string): Promise<void>;

  // Leave requests
  createLeaveRequest(data: InsertLeaveRequest): Promise<LeaveRequest>;
  getLeaveRequests(status?: string): Promise<LeaveRequest[]>;
  getLeaveRequestsByEmployee(employeeId: number): Promise<LeaveRequest[]>;
  getLeaveRequest(id: number): Promise<LeaveRequest | undefined>;
  updateLeaveRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<LeaveRequest | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getRegions(): Promise<Region[]> {
    return db.select().from(regions);
  }

  async getRegionByCode(code: string): Promise<Region | undefined> {
    const [region] = await db.select().from(regions).where(eq(regions.code, code));
    return region;
  }

  async createRegion(data: InsertRegion): Promise<Region> {
    const [region] = await db.insert(regions).values(data).returning();
    return region;
  }

  async getVenuesByRegion(regionId: number): Promise<Venue[]> {
    return db.select().from(venues).where(eq(venues.regionId, regionId));
  }

  async getAllVenues(): Promise<Venue[]> {
    return db.select().from(venues);
  }

  async getVenue(id: number): Promise<Venue | undefined> {
    const [venue] = await db.select().from(venues).where(eq(venues.id, id));
    return venue;
  }

  async createVenue(data: InsertVenue): Promise<Venue> {
    const [venue] = await db.insert(venues).values(data).returning();
    return venue;
  }

  async updateVenue(id: number, data: Partial<InsertVenue>): Promise<Venue | undefined> {
    const [venue] = await db.update(venues).set(data).where(eq(venues.id, id)).returning();
    return venue;
  }

  async getEmployeesByRegion(regionId: number): Promise<Employee[]> {
    return db.select().from(employees).where(eq(employees.regionId, regionId));
  }

  async getEmployeesForNeiQin(regionId: number): Promise<Employee[]> {
    const rows = await db.select().from(employees).where(
      or(
        eq(employees.regionId, regionId),
        eq(employees.department, "營運管理處")
      )
    );
    const seen = new Set<number>();
    return rows.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  async getAllEmployees(): Promise<Employee[]> {
    return db.select().from(employees);
  }

  async getEmployee(id: number): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.id, id));
    return emp;
  }

  async createEmployee(data: InsertEmployee): Promise<Employee> {
    const [emp] = await db.insert(employees).values(data).returning();
    return emp;
  }

  async updateEmployee(id: number, data: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [emp] = await db.update(employees).set(data).where(eq(employees.id, id)).returning();
    return emp;
  }

  async getShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    const regionEmployees = await this.getEmployeesByRegion(regionId);
    const empIds = regionEmployees.map((e) => e.id);
    if (empIds.length === 0) return [];

    return db.select().from(shifts).where(
      and(
        inArray(shifts.employeeId, empIds),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  }

  async getDispatchedShiftsToRegion(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    const regionVenues = await this.getVenuesByRegion(regionId);
    const venueIds = regionVenues.map(v => v.id);
    if (venueIds.length === 0) return [];

    return db.select().from(shifts).where(
      and(
        inArray(shifts.venueId, venueIds),
        eq(shifts.isDispatch, true),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  }

  async getShiftsByDate(date: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(eq(shifts.date, date), eq(shifts.status, "active"))
    );
  }

  async getAllShiftsByDateRange(startDate: string, endDate: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  }

  async getShiftsByEmployee(employeeId: number): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(eq(shifts.employeeId, employeeId), eq(shifts.status, "active"))
    );
  }

  async getShift(id: number): Promise<Shift | undefined> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, id));
    return shift;
  }

  async createShift(data: InsertShift, actor: string = "system"): Promise<Shift> {
    const [shift] = await db.insert(shifts).values(data).returning();
    if (shift) {
      try {
        await db.insert(shiftAuditLog).values({
          shiftId: shift.id,
          action: "create",
          actor,
          payload: { after: shift },
        });
      } catch (e) {
        console.error("[shift-audit] create log failed", e);
      }
    }
    return shift;
  }

  async updateShift(id: number, data: Partial<InsertShift>, actor: string = "system", force: boolean = false): Promise<Shift | undefined> {
    const before = await this.getShift(id);
    // Task #50 protection: any caller mutating an active shift MUST explicitly
    // opt in with force=true. Admin UI routes set force=true (admin chose to
    // edit). Automation paths (ragic-sync etc.) default to force=false so they
    // cannot silently overwrite admin-confirmed shifts.
    if (before?.status === "active" && !force) {
      throw new Error(`actor '${actor}' refused to mutate active shift ${id} without force=true (Task #50 protection)`);
    }
    const [shift] = await db.update(shifts).set(data).where(eq(shifts.id, id)).returning();
    if (shift) {
      try {
        await db.insert(shiftAuditLog).values({
          shiftId: id,
          action: "update",
          actor,
          payload: { before, after: shift, changes: data },
        });
      } catch (e) {
        console.error("[shift-audit] update log failed", e);
      }
    }
    return shift;
  }

  async deleteShift(id: number, actor: string = "system", reason?: string, force: boolean = false): Promise<boolean> {
    const before = await this.getShift(id);
    if (!before || before.status === "cancelled") return false;
    // Task #50 protection: explicit force=true required to cancel any active shift.
    if (!force) {
      throw new Error(`actor '${actor}' refused to cancel active shift ${id} without force=true (Task #50 protection)`);
    }
    const [shift] = await db.update(shifts).set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: actor,
      cancelReason: reason ?? null,
    }).where(and(eq(shifts.id, id), eq(shifts.status, "active"))).returning();
    if (!shift) return false;
    try {
      await db.insert(shiftAuditLog).values({
        shiftId: id,
        action: "cancel",
        actor,
        payload: { before, reason: reason ?? null },
      });
    } catch (e) {
      console.error("[shift-audit] cancel log failed", e);
    }
    return true;
  }

  async restoreShift(id: number, actor: string = "system"): Promise<Shift | undefined> {
    const before = await this.getShift(id);
    if (!before || before.status !== "cancelled") return undefined;
    const [shift] = await db.update(shifts).set({
      status: "active",
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
    }).where(eq(shifts.id, id)).returning();
    if (shift) {
      try {
        await db.insert(shiftAuditLog).values({
          shiftId: id,
          action: "restore",
          actor,
          payload: { before, after: shift },
        });
      } catch (e) {
        console.error("[shift-audit] restore log failed", e);
      }
    }
    return shift;
  }

  async getShiftAuditLog(shiftId: number): Promise<ShiftAuditLog[]> {
    return db.select().from(shiftAuditLog)
      .where(eq(shiftAuditLog.shiftId, shiftId))
      .orderBy(desc(shiftAuditLog.createdAt));
  }

  async getCancelledShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    const regionEmployees = await this.getEmployeesByRegion(regionId);
    const empIds = regionEmployees.map((e) => e.id);
    if (empIds.length === 0) return [];
    return db.select().from(shifts).where(
      and(
        inArray(shifts.employeeId, empIds),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "cancelled")
      )
    );
  }

  async getVenueRequirementsByRegion(regionId: number): Promise<VenueRequirement[]> {
    const regionVenues = await this.getVenuesByRegion(regionId);
    const venueIds = regionVenues.map((v) => v.id);
    if (venueIds.length === 0) return [];

    return db.select().from(venueRequirements).where(
      inArray(venueRequirements.venueId, venueIds)
    );
  }

  async createVenueRequirement(data: InsertVenueRequirement): Promise<VenueRequirement> {
    const [req] = await db.insert(venueRequirements).values(data).returning();
    return req;
  }

  async getScheduleSlotsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<ScheduleSlot[]> {
    const regionVenues = await this.getVenuesByRegion(regionId);
    const venueIds = regionVenues.map((v) => v.id);
    if (venueIds.length === 0) return [];
    return db.select().from(scheduleSlots).where(
      and(
        inArray(scheduleSlots.venueId, venueIds),
        gte(scheduleSlots.date, startDate),
        lte(scheduleSlots.date, endDate)
      )
    );
  }

  async getScheduleSlotsByVenueAndDate(venueId: number, date: string): Promise<ScheduleSlot[]> {
    return db.select().from(scheduleSlots).where(
      and(
        eq(scheduleSlots.venueId, venueId),
        eq(scheduleSlots.date, date)
      )
    );
  }

  async createScheduleSlot(data: InsertScheduleSlot): Promise<ScheduleSlot> {
    const [slot] = await db.insert(scheduleSlots).values(data).returning();
    return slot;
  }

  async updateScheduleSlot(id: number, data: Partial<InsertScheduleSlot>): Promise<ScheduleSlot | undefined> {
    const [slot] = await db.update(scheduleSlots).set(data).where(eq(scheduleSlots.id, id)).returning();
    return slot;
  }

  async deleteScheduleSlot(id: number): Promise<boolean> {
    const result = await db.delete(scheduleSlots).where(eq(scheduleSlots.id, id)).returning();
    return result.length > 0;
  }

  async getVenueShiftTemplates(venueId: number): Promise<VenueShiftTemplate[]> {
    return db.select().from(venueShiftTemplates).where(eq(venueShiftTemplates.venueId, venueId));
  }

  async createVenueShiftTemplate(data: InsertVenueShiftTemplate): Promise<VenueShiftTemplate> {
    const [t] = await db.insert(venueShiftTemplates).values(data).returning();
    return t;
  }

  async deleteVenueShiftTemplate(id: number): Promise<boolean> {
    const result = await db.delete(venueShiftTemplates).where(eq(venueShiftTemplates.id, id)).returning();
    return result.length > 0;
  }

  async deleteVenueShiftTemplatesByVenue(venueId: number): Promise<void> {
    await db.delete(venueShiftTemplates).where(eq(venueShiftTemplates.venueId, venueId));
  }

  async getEmployeeByCode(code: string): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.employeeCode, code));
    return emp;
  }

  async getAttendanceUploads(): Promise<AttendanceUpload[]> {
    return db.select().from(attendanceUploads).orderBy(desc(attendanceUploads.uploadedAt));
  }

  async createAttendanceUpload(data: InsertAttendanceUpload): Promise<AttendanceUpload> {
    const [upload] = await db.insert(attendanceUploads).values(data).returning();
    return upload;
  }

  async updateAttendanceUpload(id: number, data: Partial<InsertAttendanceUpload>): Promise<AttendanceUpload | undefined> {
    const [upload] = await db.update(attendanceUploads).set(data).where(eq(attendanceUploads.id, id)).returning();
    return upload;
  }

  async deleteAttendanceUpload(id: number): Promise<boolean> {
    const result = await db.delete(attendanceUploads).where(eq(attendanceUploads.id, id)).returning();
    return result.length > 0;
  }

  async createAttendanceRecords(records: InsertAttendanceRecord[]): Promise<AttendanceRecord[]> {
    if (records.length === 0) return [];
    const batchSize = 100;
    const allResults: AttendanceRecord[] = [];
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const results = await db.insert(attendanceRecords).values(batch).returning();
      allResults.push(...results);
    }
    return allResults;
  }

  async getAttendanceRecordsByUpload(uploadId: number): Promise<AttendanceRecord[]> {
    return db.select().from(attendanceRecords).where(eq(attendanceRecords.uploadId, uploadId));
  }

  async getAttendanceRecordsByDateRange(startDate: string, endDate: string, employeeCodes?: string[]): Promise<AttendanceRecord[]> {
    const conditions = [
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ];
    if (employeeCodes && employeeCodes.length > 0) {
      conditions.push(inArray(attendanceRecords.employeeCode, employeeCodes));
    }
    return db.select().from(attendanceRecords).where(and(...conditions));
  }

  async deleteAttendanceRecordsByUpload(uploadId: number): Promise<void> {
    await db.delete(attendanceRecords).where(eq(attendanceRecords.uploadId, uploadId));
  }

  async getGuidelines(category?: string): Promise<Guideline[]> {
    if (category) {
      return db.select().from(guidelines).where(eq(guidelines.category, category)).orderBy(guidelines.sortOrder);
    }
    return db.select().from(guidelines).orderBy(guidelines.sortOrder);
  }

  async getGuideline(id: number): Promise<Guideline | undefined> {
    const [g] = await db.select().from(guidelines).where(eq(guidelines.id, id));
    return g;
  }

  async createGuideline(data: InsertGuideline): Promise<Guideline> {
    const [g] = await db.insert(guidelines).values(data).returning();
    return g;
  }

  async updateGuideline(id: number, data: Partial<InsertGuideline>): Promise<Guideline | undefined> {
    const [g] = await db.update(guidelines).set({ ...data, updatedAt: new Date() }).where(eq(guidelines.id, id)).returning();
    return g;
  }

  async deleteGuideline(id: number): Promise<boolean> {
    await db.delete(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.guidelineId, id));
    const result = await db.delete(guidelines).where(eq(guidelines.id, id)).returning();
    return result.length > 0;
  }

  async getGuidelineAcks(guidelineId: number): Promise<GuidelineAck[]> {
    return db.select().from(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.guidelineId, guidelineId));
  }

  async createGuidelineAck(data: InsertGuidelineAck): Promise<GuidelineAck> {
    const [ack] = await db.insert(guidelineAcknowledgments).values(data).returning();
    return ack;
  }

  async getGuidelineAcksByEmployee(employeeId: number): Promise<GuidelineAck[]> {
    return db.select().from(guidelineAcknowledgments).where(eq(guidelineAcknowledgments.employeeId, employeeId));
  }

  async getEmployeeByLineId(lineId: string): Promise<Employee | undefined> {
    const [emp] = await db.select().from(employees).where(eq(employees.lineId, lineId));
    return emp;
  }

  async getShiftsByEmployeeAndDateRange(employeeId: number, startDate: string, endDate: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(
        eq(shifts.employeeId, employeeId),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  }

  async getShiftsByEmployeesAndDateRange(employeeIds: number[], startDate: string, endDate: string): Promise<Shift[]> {
    if (employeeIds.length === 0) return [];
    return db.select().from(shifts).where(
      and(
        inArray(shifts.employeeId, employeeIds),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  }

  async getShiftsByVenueAndDate(venueId: number, date: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(
        eq(shifts.venueId, venueId),
        eq(shifts.date, date),
        eq(shifts.status, "active")
      )
    );
  }

  async getCoworkersByVenueAndDate(venueId: number, date: string, excludeEmployeeId: number): Promise<Employee[]> {
    const venueShifts = await db.select().from(shifts).where(
      and(
        eq(shifts.venueId, venueId),
        eq(shifts.date, date),
        eq(shifts.status, "active")
      )
    );
    const coworkerIds = venueShifts
      .map((s) => s.employeeId)
      .filter((id) => id !== excludeEmployeeId);
    if (coworkerIds.length === 0) return [];
    const uniqueIds = Array.from(new Set(coworkerIds));
    return db.select().from(employees).where(inArray(employees.id, uniqueIds));
  }

  async deleteEmployee(id: number): Promise<boolean> {
    const result = await db.delete(employees).where(eq(employees.id, id)).returning();
    return result.length > 0;
  }

  async createClockRecord(data: InsertClockRecord): Promise<ClockRecord> {
    const [record] = await db.insert(clockRecords).values(data).returning();
    return record;
  }

  async getClockRecord(id: number): Promise<ClockRecord | undefined> {
    const [record] = await db.select().from(clockRecords).where(eq(clockRecords.id, id));
    return record;
  }

  async getClockRecordsByDateRange(startDate: string, endDate: string): Promise<ClockRecord[]> {
    return db.select().from(clockRecords).where(
      and(
        gte(clockRecords.clockTime, new Date(startDate + "T00:00:00+08:00")),
        lte(clockRecords.clockTime, new Date(endDate + "T23:59:59+08:00"))
      )
    ).orderBy(desc(clockRecords.clockTime));
  }

  async getClockRecordsByEmployee(employeeId: number, startDate: string, endDate: string): Promise<ClockRecord[]> {
    return db.select().from(clockRecords).where(
      and(
        eq(clockRecords.employeeId, employeeId),
        gte(clockRecords.clockTime, new Date(startDate + "T00:00:00+08:00")),
        lte(clockRecords.clockTime, new Date(endDate + "T23:59:59+08:00"))
      )
    ).orderBy(desc(clockRecords.clockTime));
  }

  async createClockAmendment(data: InsertClockAmendment): Promise<ClockAmendment> {
    const [record] = await db.insert(clockAmendments).values(data).returning();
    return record;
  }

  async getClockAmendments(status?: string): Promise<ClockAmendment[]> {
    if (status) {
      return db.select().from(clockAmendments)
        .where(eq(clockAmendments.status, status))
        .orderBy(desc(clockAmendments.createdAt));
    }
    return db.select().from(clockAmendments).orderBy(desc(clockAmendments.createdAt));
  }

  async getClockAmendmentsByEmployee(employeeId: number): Promise<ClockAmendment[]> {
    return db.select().from(clockAmendments)
      .where(eq(clockAmendments.employeeId, employeeId))
      .orderBy(desc(clockAmendments.createdAt));
  }

  async getClockAmendment(id: number): Promise<ClockAmendment | undefined> {
    const [record] = await db.select().from(clockAmendments).where(eq(clockAmendments.id, id));
    return record;
  }

  async updateClockAmendmentStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<ClockAmendment | undefined> {
    const [record] = await db.update(clockAmendments).set({
      status,
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    }).where(eq(clockAmendments.id, id)).returning();
    return record;
  }

  async createDispatchShift(data: InsertDispatchShift): Promise<DispatchShift> {
    const [record] = await db.insert(dispatchShifts).values(data).returning();
    return record;
  }

  async batchCreateDispatchShifts(data: InsertDispatchShift[]): Promise<DispatchShift[]> {
    if (data.length === 0) return [];
    const results: DispatchShift[] = [];
    for (const item of data) {
      const [record] = await db.insert(dispatchShifts).values(item).returning();
      results.push(record);
    }
    return results;
  }

  async getDispatchShifts(regionId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return db.select().from(dispatchShifts)
      .where(and(
        eq(dispatchShifts.regionId, regionId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
      ));
  }

  async getDispatchShiftsByDate(date: string): Promise<DispatchShift[]> {
    return db.select().from(dispatchShifts).where(eq(dispatchShifts.date, date));
  }

  async getDispatchShiftsByLinkedEmployee(employeeId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return db.select().from(dispatchShifts).where(
      and(
        eq(dispatchShifts.linkedEmployeeId, employeeId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
      )
    );
  }

  async getDispatchShift(id: number): Promise<DispatchShift | undefined> {
    const [record] = await db.select().from(dispatchShifts).where(eq(dispatchShifts.id, id));
    return record;
  }

  async updateDispatchShift(id: number, data: Partial<InsertDispatchShift>): Promise<DispatchShift | undefined> {
    const [record] = await db.update(dispatchShifts).set(data).where(eq(dispatchShifts.id, id)).returning();
    return record;
  }

  async deleteDispatchShift(id: number): Promise<void> {
    await db.delete(dispatchShifts).where(eq(dispatchShifts.id, id));
  }

  async reconcileDispatchLinks(): Promise<number> {
    const activeEmployees = await db.select().from(employees).where(eq(employees.status, "active"));
    const nameToId = new Map<string, number>();
    for (const emp of activeEmployees) {
      nameToId.set(emp.name.trim(), emp.id);
    }
    const unlinked = await db.select().from(dispatchShifts).where(isNull(dispatchShifts.linkedEmployeeId));
    let count = 0;
    for (const ds of unlinked) {
      if (!ds.dispatchName) continue;
      const empId = nameToId.get(ds.dispatchName.trim());
      if (empId) {
        await db.update(dispatchShifts).set({ linkedEmployeeId: empId }).where(eq(dispatchShifts.id, ds.id));
        count++;
      }
    }
    return count;
  }

  async updateClockRecordReason(id: number, earlyArrivalReason?: string, lateDepartureReason?: string): Promise<ClockRecord | undefined> {
    const updates: Record<string, any> = {};
    if (earlyArrivalReason !== undefined) updates.earlyArrivalReason = earlyArrivalReason;
    if (lateDepartureReason !== undefined) updates.lateDepartureReason = lateDepartureReason;
    if (Object.keys(updates).length === 0) return undefined;
    const [record] = await db.update(clockRecords).set(updates).where(eq(clockRecords.id, id)).returning();
    return record;
  }

  async createOvertimeRequest(data: InsertOvertimeRequest): Promise<OvertimeRequest> {
    const [record] = await db.insert(overtimeRequests).values(data).returning();
    return record;
  }

  async getOvertimeRequests(status?: string): Promise<OvertimeRequest[]> {
    if (status) {
      return db.select().from(overtimeRequests)
        .where(eq(overtimeRequests.status, status))
        .orderBy(desc(overtimeRequests.createdAt));
    }
    return db.select().from(overtimeRequests).orderBy(desc(overtimeRequests.createdAt));
  }

  async getOvertimeRequestsByEmployee(employeeId: number): Promise<OvertimeRequest[]> {
    return db.select().from(overtimeRequests)
      .where(eq(overtimeRequests.employeeId, employeeId))
      .orderBy(desc(overtimeRequests.createdAt));
  }

  async getOvertimeRequest(id: number): Promise<OvertimeRequest | undefined> {
    const [record] = await db.select().from(overtimeRequests).where(eq(overtimeRequests.id, id));
    return record;
  }

  async updateOvertimeRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<OvertimeRequest | undefined> {
    const [record] = await db.update(overtimeRequests).set({
      status,
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    }).where(eq(overtimeRequests.id, id)).returning();
    return record;
  }

  async getOvertimeRequestsByEmployeeAndDate(employeeId: number, date: string): Promise<OvertimeRequest[]> {
    return db.select().from(overtimeRequests).where(
      and(
        eq(overtimeRequests.employeeId, employeeId),
        eq(overtimeRequests.date, date)
      )
    );
  }

  async getApprovedOvertimeByDateRange(startDate: string, endDate: string): Promise<OvertimeRequest[]> {
    return db.select().from(overtimeRequests).where(
      and(
        eq(overtimeRequests.status, "approved"),
        gte(overtimeRequests.date, startDate),
        lte(overtimeRequests.date, endDate)
      )
    );
  }

  async createAnomalyReport(data: InsertAnomalyReport): Promise<AnomalyReport> {
    const [record] = await db.insert(anomalyReports).values(data).returning();
    return record;
  }

  async getAnomalyReports(): Promise<AnomalyReport[]> {
    return db.select().from(anomalyReports).orderBy(desc(anomalyReports.createdAt));
  }

  async getAnomalyReport(id: number): Promise<AnomalyReport | undefined> {
    const [record] = await db.select().from(anomalyReports).where(eq(anomalyReports.id, id));
    return record;
  }

  async updateAnomalyResolution(id: number, resolution: string, resolvedNote?: string): Promise<AnomalyReport | undefined> {
    const [record] = await db.update(anomalyReports).set({
      resolution,
      resolvedNote: resolvedNote || null,
    }).where(eq(anomalyReports.id, id)).returning();
    return record;
  }

  async deleteAnomalyReport(id: number): Promise<void> {
    await db.delete(anomalyReports).where(eq(anomalyReports.id, id));
  }

  async getNotificationRecipients(): Promise<NotificationRecipient[]> {
    return db.select().from(notificationRecipients).orderBy(desc(notificationRecipients.createdAt));
  }

  async createNotificationRecipient(data: InsertNotificationRecipient): Promise<NotificationRecipient> {
    const [record] = await db.insert(notificationRecipients).values(data).returning();
    return record;
  }

  async updateNotificationRecipient(id: number, data: Partial<InsertNotificationRecipient>): Promise<NotificationRecipient | undefined> {
    const [record] = await db.update(notificationRecipients).set(data).where(eq(notificationRecipients.id, id)).returning();
    return record;
  }

  async deleteNotificationRecipient(id: number): Promise<void> {
    await db.delete(notificationRecipients).where(eq(notificationRecipients.id, id));
  }

  async getSalaryRates(): Promise<SalaryRateConfig[]> {
    return db.select().from(salaryRateConfigs).orderBy(salaryRateConfigs.role);
  }

  async upsertSalaryRate(role: string, ratePerHour: number, label?: string): Promise<SalaryRateConfig> {
    const existing = await db.select().from(salaryRateConfigs).where(eq(salaryRateConfigs.role, role));
    if (existing.length > 0) {
      const [updated] = await db.update(salaryRateConfigs)
        .set({ ratePerHour, label, updatedAt: new Date() })
        .where(eq(salaryRateConfigs.role, role))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(salaryRateConfigs)
        .values({ role, ratePerHour, label })
        .returning();
      return created;
    }
  }
  async getSystemConfig(key: string): Promise<SystemConfig | undefined> {
    const [config] = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key));
    return config;
  }

  async upsertSystemConfig(key: string, value: string): Promise<SystemConfig> {
    const existing = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key));
    if (existing.length > 0) {
      const [updated] = await db.update(systemConfigs)
        .set({ value, updatedAt: new Date() })
        .where(eq(systemConfigs.key, key))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(systemConfigs)
        .values({ key, value })
        .returning();
      return created;
    }
  }

  // ── Missing clock-in notification tracking ────────────────────────────────
  async hasMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<boolean> {
    const [row] = await db.select({ id: missingClockNotifications.id })
      .from(missingClockNotifications)
      .where(and(
        eq(missingClockNotifications.date, date),
        eq(missingClockNotifications.employeeId, employeeId),
        eq(missingClockNotifications.shiftId, shiftId),
      ))
      .limit(1);
    return !!row;
  }

  async createMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<void> {
    await db.insert(missingClockNotifications)
      .values({ date, employeeId, shiftId })
      .onConflictDoNothing();
  }

  async clearOldMissingClockNotifications(beforeDate: string): Promise<void> {
    await db.delete(missingClockNotifications)
      .where(and(
        // delete all records with date < beforeDate
        lte(missingClockNotifications.date, beforeDate),
      ));
  }

  async getMissingClockNotificationsForDate(date: string): Promise<MissingClockNotification[]> {
    return db.select().from(missingClockNotifications)
      .where(eq(missingClockNotifications.date, date));
  }

  // ── Weekly push notification deduplication ────────────────────────────────
  async hasWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string): Promise<boolean> {
    const [row] = await db.select({ id: weeklyPushNotifications.id })
      .from(weeklyPushNotifications)
      .where(and(
        eq(weeklyPushNotifications.weekStartDate, weekStartDate),
        eq(weeklyPushNotifications.employeeId, employeeId),
        eq(weeklyPushNotifications.pushType, pushType),
      ))
      .limit(1);
    return !!row;
  }

  async createWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string): Promise<void> {
    await db.insert(weeklyPushNotifications)
      .values({ weekStartDate, employeeId, pushType })
      .onConflictDoNothing();
  }

  async clearOldWeeklyPushNotifications(beforeWeekStart: string): Promise<void> {
    await db.delete(weeklyPushNotifications)
      .where(lte(weeklyPushNotifications.weekStartDate, beforeWeekStart));
  }

  async createLeaveRequest(data: InsertLeaveRequest): Promise<LeaveRequest> {
    const [row] = await db.insert(leaveRequests).values(data).returning();
    return row;
  }

  async getLeaveRequests(status?: string): Promise<LeaveRequest[]> {
    if (status) {
      return db.select().from(leaveRequests).where(eq(leaveRequests.status, status)).orderBy(desc(leaveRequests.createdAt));
    }
    return db.select().from(leaveRequests).orderBy(desc(leaveRequests.createdAt));
  }

  async getLeaveRequestsByEmployee(employeeId: number): Promise<LeaveRequest[]> {
    return db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).orderBy(desc(leaveRequests.createdAt));
  }

  async getLeaveRequest(id: number): Promise<LeaveRequest | undefined> {
    const [row] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    return row;
  }

  async updateLeaveRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<LeaveRequest | undefined> {
    const [row] = await db.update(leaveRequests)
      .set({ status, reviewedBy, reviewedByName, reviewNote: reviewNote || null, reviewedAt: new Date() })
      .where(eq(leaveRequests.id, id))
      .returning();
    return row;
  }
}

export const storage = new DatabaseStorage();

export async function ensureShiftsSoftDelete(): Promise<void> {
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

export async function ensureAnnouncementsTable(): Promise<void> {
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

export async function ensureLeaveRequestsTable(): Promise<void> {
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

/**
 * Ensures the weekly_push_notifications table exists with the required unique constraint.
 * Called at server startup so the table is guaranteed to exist before any cron/API access.
 */
export async function ensureWeeklyPushTable(): Promise<void> {
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
