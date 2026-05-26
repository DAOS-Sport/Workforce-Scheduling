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

import { regionRepository } from "./modules/region/region.repository";
import { venueRepository } from "./modules/venue/venue.repository";
import { employeeRepository } from "./modules/employee/employee.repository";
import { shiftRepository } from "./modules/shift/shift.repository";
import { scheduleSlotRepository } from "./modules/scheduleSlot/scheduleSlot.repository";
import { attendanceRepository } from "./modules/attendance/attendance.repository";
import { guidelineRepository } from "./modules/guideline/guideline.repository";
import { clockRepository } from "./modules/clock/clock.repository";
import { dispatchRepository } from "./modules/dispatch/dispatch.repository";
import { overtimeRepository } from "./modules/overtime/overtime.repository";
import { anomalyRepository } from "./modules/anomaly/anomaly.repository";
import { notificationRepository } from "./modules/notification/notification.repository";
import { systemRepository } from "./modules/system/system.repository";
import { leaveRepository } from "./modules/leave/leave.repository";

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
  getAllGuidelineAcksWithDetails(): Promise<import("./modules/guideline/guideline.repository").GuidelineAckDetail[]>;

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
  applyClockRecordAmendment(clockRecordId: number, amendedTime: Date, amendmentId: number, newFailReason: string | null): Promise<ClockRecord | undefined>;

  createDispatchShift(data: InsertDispatchShift): Promise<DispatchShift>;
  batchCreateDispatchShifts(data: InsertDispatchShift[]): Promise<DispatchShift[]>;
  getDispatchShifts(regionId: number, startDate: string, endDate: string): Promise<DispatchShift[]>;
  getDispatchShiftsByDate(date: string): Promise<DispatchShift[]>;
  getDispatchShiftsByLinkedEmployee(employeeId: number, startDate: string, endDate: string): Promise<DispatchShift[]>;
  getDispatchShift(id: number): Promise<DispatchShift | undefined>;
  updateDispatchShift(id: number, data: Partial<InsertDispatchShift>): Promise<DispatchShift | undefined>;
  deleteDispatchShift(id: number, actor?: string, reason?: string): Promise<boolean>;
  restoreDispatchShift(id: number, actor?: string): Promise<DispatchShift | undefined>;
  getCancelledDispatchShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<DispatchShift[]>;
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

/**
 * Façade that delegates every IStorage method to a per-domain repository.
 * Behavior parity preserved: Task #50 force=true protection + audit-log writes
 * for shifts live inside shiftRepository and are exercised through this façade.
 */
export class DatabaseStorage implements IStorage {
  async getRegions(): Promise<Region[]> {
    return regionRepository.getRegions();
  }

  async getRegionByCode(code: string): Promise<Region | undefined> {
    return regionRepository.getRegionByCode(code);
  }

  async createRegion(data: InsertRegion): Promise<Region> {
    return regionRepository.createRegion(data);
  }

  async getVenuesByRegion(regionId: number): Promise<Venue[]> {
    return venueRepository.getVenuesByRegion(regionId);
  }

  async getAllVenues(): Promise<Venue[]> {
    return venueRepository.getAllVenues();
  }

  async getVenue(id: number): Promise<Venue | undefined> {
    return venueRepository.getVenue(id);
  }

  async createVenue(data: InsertVenue): Promise<Venue> {
    return venueRepository.createVenue(data);
  }

  async updateVenue(id: number, data: Partial<InsertVenue>): Promise<Venue | undefined> {
    return venueRepository.updateVenue(id, data);
  }

  async getEmployeesByRegion(regionId: number): Promise<Employee[]> {
    return employeeRepository.getEmployeesByRegion(regionId);
  }

  async getEmployeesForNeiQin(regionId: number): Promise<Employee[]> {
    return employeeRepository.getEmployeesForNeiQin(regionId);
  }

  async getAllEmployees(): Promise<Employee[]> {
    return employeeRepository.getAllEmployees();
  }

  async getEmployee(id: number): Promise<Employee | undefined> {
    return employeeRepository.getEmployee(id);
  }

  async createEmployee(data: InsertEmployee): Promise<Employee> {
    return employeeRepository.createEmployee(data);
  }

  async updateEmployee(id: number, data: Partial<InsertEmployee>): Promise<Employee | undefined> {
    return employeeRepository.updateEmployee(id, data);
  }

  async getShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    return shiftRepository.getShiftsByRegionAndDateRange(regionId, startDate, endDate);
  }

  async getDispatchedShiftsToRegion(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    return shiftRepository.getDispatchedShiftsToRegion(regionId, startDate, endDate);
  }

  async getShiftsByDate(date: string): Promise<Shift[]> {
    return shiftRepository.getShiftsByDate(date);
  }

  async getAllShiftsByDateRange(startDate: string, endDate: string): Promise<Shift[]> {
    return shiftRepository.getAllShiftsByDateRange(startDate, endDate);
  }

  async getShiftsByEmployee(employeeId: number): Promise<Shift[]> {
    return shiftRepository.getShiftsByEmployee(employeeId);
  }

  async getShift(id: number): Promise<Shift | undefined> {
    return shiftRepository.getShift(id);
  }

  async createShift(data: InsertShift, actor: string = "system"): Promise<Shift> {
    return shiftRepository.createShift(data, actor);
  }

  async updateShift(id: number, data: Partial<InsertShift>, actor: string = "system", force: boolean = false): Promise<Shift | undefined> {
    return shiftRepository.updateShift(id, data, actor, force);
  }

  async deleteShift(id: number, actor: string = "system", reason?: string, force: boolean = false): Promise<boolean> {
    return shiftRepository.deleteShift(id, actor, reason, force);
  }

  async restoreShift(id: number, actor: string = "system"): Promise<Shift | undefined> {
    return shiftRepository.restoreShift(id, actor);
  }

  async getShiftAuditLog(shiftId: number): Promise<ShiftAuditLog[]> {
    return shiftRepository.getShiftAuditLog(shiftId);
  }

  async getCancelledShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    return shiftRepository.getCancelledShiftsByRegionAndDateRange(regionId, startDate, endDate);
  }

  async getVenueRequirementsByRegion(regionId: number): Promise<VenueRequirement[]> {
    return venueRepository.getVenueRequirementsByRegion(regionId);
  }

  async createVenueRequirement(data: InsertVenueRequirement): Promise<VenueRequirement> {
    return venueRepository.createVenueRequirement(data);
  }

  async getScheduleSlotsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<ScheduleSlot[]> {
    return scheduleSlotRepository.getScheduleSlotsByRegionAndDateRange(regionId, startDate, endDate);
  }

  async getScheduleSlotsByVenueAndDate(venueId: number, date: string): Promise<ScheduleSlot[]> {
    return scheduleSlotRepository.getScheduleSlotsByVenueAndDate(venueId, date);
  }

  async createScheduleSlot(data: InsertScheduleSlot): Promise<ScheduleSlot> {
    return scheduleSlotRepository.createScheduleSlot(data);
  }

  async updateScheduleSlot(id: number, data: Partial<InsertScheduleSlot>): Promise<ScheduleSlot | undefined> {
    return scheduleSlotRepository.updateScheduleSlot(id, data);
  }

  async deleteScheduleSlot(id: number): Promise<boolean> {
    return scheduleSlotRepository.deleteScheduleSlot(id);
  }

  async getVenueShiftTemplates(venueId: number): Promise<VenueShiftTemplate[]> {
    return venueRepository.getVenueShiftTemplates(venueId);
  }

  async createVenueShiftTemplate(data: InsertVenueShiftTemplate): Promise<VenueShiftTemplate> {
    return venueRepository.createVenueShiftTemplate(data);
  }

  async deleteVenueShiftTemplate(id: number): Promise<boolean> {
    return venueRepository.deleteVenueShiftTemplate(id);
  }

  async deleteVenueShiftTemplatesByVenue(venueId: number): Promise<void> {
    return venueRepository.deleteVenueShiftTemplatesByVenue(venueId);
  }

  async getEmployeeByCode(code: string): Promise<Employee | undefined> {
    return employeeRepository.getEmployeeByCode(code);
  }

  async getAttendanceUploads(): Promise<AttendanceUpload[]> {
    return attendanceRepository.getAttendanceUploads();
  }

  async createAttendanceUpload(data: InsertAttendanceUpload): Promise<AttendanceUpload> {
    return attendanceRepository.createAttendanceUpload(data);
  }

  async updateAttendanceUpload(id: number, data: Partial<InsertAttendanceUpload>): Promise<AttendanceUpload | undefined> {
    return attendanceRepository.updateAttendanceUpload(id, data);
  }

  async deleteAttendanceUpload(id: number): Promise<boolean> {
    return attendanceRepository.deleteAttendanceUpload(id);
  }

  async createAttendanceRecords(records: InsertAttendanceRecord[]): Promise<AttendanceRecord[]> {
    return attendanceRepository.createAttendanceRecords(records);
  }

  async getAttendanceRecordsByUpload(uploadId: number): Promise<AttendanceRecord[]> {
    return attendanceRepository.getAttendanceRecordsByUpload(uploadId);
  }

  async getAttendanceRecordsByDateRange(startDate: string, endDate: string, employeeCodes?: string[]): Promise<AttendanceRecord[]> {
    return attendanceRepository.getAttendanceRecordsByDateRange(startDate, endDate, employeeCodes);
  }

  async deleteAttendanceRecordsByUpload(uploadId: number): Promise<void> {
    return attendanceRepository.deleteAttendanceRecordsByUpload(uploadId);
  }

  async getGuidelines(category?: string): Promise<Guideline[]> {
    return guidelineRepository.getGuidelines(category);
  }

  async getGuideline(id: number): Promise<Guideline | undefined> {
    return guidelineRepository.getGuideline(id);
  }

  async createGuideline(data: InsertGuideline): Promise<Guideline> {
    return guidelineRepository.createGuideline(data);
  }

  async updateGuideline(id: number, data: Partial<InsertGuideline>): Promise<Guideline | undefined> {
    return guidelineRepository.updateGuideline(id, data);
  }

  async deleteGuideline(id: number): Promise<boolean> {
    return guidelineRepository.deleteGuideline(id);
  }

  async getGuidelineAcks(guidelineId: number): Promise<GuidelineAck[]> {
    return guidelineRepository.getGuidelineAcks(guidelineId);
  }

  async createGuidelineAck(data: InsertGuidelineAck): Promise<GuidelineAck> {
    return guidelineRepository.createGuidelineAck(data);
  }

  async getGuidelineAcksByEmployee(employeeId: number): Promise<GuidelineAck[]> {
    return guidelineRepository.getGuidelineAcksByEmployee(employeeId);
  }

  async getAllGuidelineAcksWithDetails() {
    return guidelineRepository.getAllGuidelineAcksWithDetails();
  }

  async getEmployeeByLineId(lineId: string): Promise<Employee | undefined> {
    return employeeRepository.getEmployeeByLineId(lineId);
  }

  async getShiftsByEmployeeAndDateRange(employeeId: number, startDate: string, endDate: string): Promise<Shift[]> {
    return shiftRepository.getShiftsByEmployeeAndDateRange(employeeId, startDate, endDate);
  }

  async getShiftsByEmployeesAndDateRange(employeeIds: number[], startDate: string, endDate: string): Promise<Shift[]> {
    return shiftRepository.getShiftsByEmployeesAndDateRange(employeeIds, startDate, endDate);
  }

  async getShiftsByVenueAndDate(venueId: number, date: string): Promise<Shift[]> {
    return shiftRepository.getShiftsByVenueAndDate(venueId, date);
  }

  async getCoworkersByVenueAndDate(venueId: number, date: string, excludeEmployeeId: number): Promise<Employee[]> {
    return employeeRepository.getCoworkersByVenueAndDate(venueId, date, excludeEmployeeId);
  }

  async deleteEmployee(id: number): Promise<boolean> {
    return employeeRepository.deleteEmployee(id);
  }

  async createClockRecord(data: InsertClockRecord): Promise<ClockRecord> {
    return clockRepository.createClockRecord(data);
  }

  async getClockRecord(id: number): Promise<ClockRecord | undefined> {
    return clockRepository.getClockRecord(id);
  }

  async getClockRecordsByDateRange(startDate: string, endDate: string): Promise<ClockRecord[]> {
    return clockRepository.getClockRecordsByDateRange(startDate, endDate);
  }

  async getClockRecordsByEmployee(employeeId: number, startDate: string, endDate: string): Promise<ClockRecord[]> {
    return clockRepository.getClockRecordsByEmployee(employeeId, startDate, endDate);
  }

  async createClockAmendment(data: InsertClockAmendment): Promise<ClockAmendment> {
    return clockRepository.createClockAmendment(data);
  }

  async getClockAmendments(status?: string): Promise<ClockAmendment[]> {
    return clockRepository.getClockAmendments(status);
  }

  async getClockAmendmentsByEmployee(employeeId: number): Promise<ClockAmendment[]> {
    return clockRepository.getClockAmendmentsByEmployee(employeeId);
  }

  async getClockAmendment(id: number): Promise<ClockAmendment | undefined> {
    return clockRepository.getClockAmendment(id);
  }

  async updateClockAmendmentStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<ClockAmendment | undefined> {
    return clockRepository.updateClockAmendmentStatus(id, status, reviewedBy, reviewedByName, reviewNote);
  }

  async createDispatchShift(data: InsertDispatchShift): Promise<DispatchShift> {
    return dispatchRepository.createDispatchShift(data);
  }

  async batchCreateDispatchShifts(data: InsertDispatchShift[]): Promise<DispatchShift[]> {
    return dispatchRepository.batchCreateDispatchShifts(data);
  }

  async getDispatchShifts(regionId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return dispatchRepository.getDispatchShifts(regionId, startDate, endDate);
  }

  async getDispatchShiftsByDate(date: string): Promise<DispatchShift[]> {
    return dispatchRepository.getDispatchShiftsByDate(date);
  }

  async getDispatchShiftsByLinkedEmployee(employeeId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return dispatchRepository.getDispatchShiftsByLinkedEmployee(employeeId, startDate, endDate);
  }

  async getDispatchShift(id: number): Promise<DispatchShift | undefined> {
    return dispatchRepository.getDispatchShift(id);
  }

  async updateDispatchShift(id: number, data: Partial<InsertDispatchShift>): Promise<DispatchShift | undefined> {
    return dispatchRepository.updateDispatchShift(id, data);
  }

  async deleteDispatchShift(id: number, actor = "admin", reason?: string): Promise<boolean> {
    return dispatchRepository.deleteDispatchShift(id, actor, reason);
  }

  async restoreDispatchShift(id: number, actor = "admin"): Promise<DispatchShift | undefined> {
    return dispatchRepository.restoreDispatchShift(id, actor);
  }

  async getCancelledDispatchShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return dispatchRepository.getCancelledDispatchShiftsByRegionAndDateRange(regionId, startDate, endDate);
  }

  async reconcileDispatchLinks(): Promise<number> {
    return dispatchRepository.reconcileDispatchLinks();
  }

  async updateClockRecordReason(id: number, earlyArrivalReason?: string, lateDepartureReason?: string): Promise<ClockRecord | undefined> {
    return clockRepository.updateClockRecordReason(id, earlyArrivalReason, lateDepartureReason);
  }

  async applyClockRecordAmendment(clockRecordId: number, amendedTime: Date, amendmentId: number, newFailReason: string | null): Promise<ClockRecord | undefined> {
    return clockRepository.applyClockRecordAmendment(clockRecordId, amendedTime, amendmentId, newFailReason);
  }

  async createOvertimeRequest(data: InsertOvertimeRequest): Promise<OvertimeRequest> {
    return overtimeRepository.createOvertimeRequest(data);
  }

  async getOvertimeRequests(status?: string): Promise<OvertimeRequest[]> {
    return overtimeRepository.getOvertimeRequests(status);
  }

  async getOvertimeRequestsByEmployee(employeeId: number): Promise<OvertimeRequest[]> {
    return overtimeRepository.getOvertimeRequestsByEmployee(employeeId);
  }

  async getOvertimeRequest(id: number): Promise<OvertimeRequest | undefined> {
    return overtimeRepository.getOvertimeRequest(id);
  }

  async updateOvertimeRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<OvertimeRequest | undefined> {
    return overtimeRepository.updateOvertimeRequestStatus(id, status, reviewedBy, reviewedByName, reviewNote);
  }

  async getOvertimeRequestsByEmployeeAndDate(employeeId: number, date: string): Promise<OvertimeRequest[]> {
    return overtimeRepository.getOvertimeRequestsByEmployeeAndDate(employeeId, date);
  }

  async getApprovedOvertimeByDateRange(startDate: string, endDate: string): Promise<OvertimeRequest[]> {
    return overtimeRepository.getApprovedOvertimeByDateRange(startDate, endDate);
  }

  async createAnomalyReport(data: InsertAnomalyReport): Promise<AnomalyReport> {
    return anomalyRepository.createAnomalyReport(data);
  }

  async getAnomalyReports(): Promise<AnomalyReport[]> {
    return anomalyRepository.getAnomalyReports();
  }

  async getAnomalyReport(id: number): Promise<AnomalyReport | undefined> {
    return anomalyRepository.getAnomalyReport(id);
  }

  async updateAnomalyResolution(id: number, resolution: string, resolvedNote?: string): Promise<AnomalyReport | undefined> {
    return anomalyRepository.updateAnomalyResolution(id, resolution, resolvedNote);
  }

  async deleteAnomalyReport(id: number): Promise<void> {
    return anomalyRepository.deleteAnomalyReport(id);
  }

  async getNotificationRecipients(): Promise<NotificationRecipient[]> {
    return notificationRepository.getNotificationRecipients();
  }

  async createNotificationRecipient(data: InsertNotificationRecipient): Promise<NotificationRecipient> {
    return notificationRepository.createNotificationRecipient(data);
  }

  async updateNotificationRecipient(id: number, data: Partial<InsertNotificationRecipient>): Promise<NotificationRecipient | undefined> {
    return notificationRepository.updateNotificationRecipient(id, data);
  }

  async deleteNotificationRecipient(id: number): Promise<void> {
    return notificationRepository.deleteNotificationRecipient(id);
  }

  async getSalaryRates(): Promise<SalaryRateConfig[]> {
    return systemRepository.getSalaryRates();
  }

  async upsertSalaryRate(role: string, ratePerHour: number, label?: string): Promise<SalaryRateConfig> {
    return systemRepository.upsertSalaryRate(role, ratePerHour, label);
  }

  async getSystemConfig(key: string): Promise<SystemConfig | undefined> {
    return systemRepository.getSystemConfig(key);
  }

  async upsertSystemConfig(key: string, value: string): Promise<SystemConfig> {
    return systemRepository.upsertSystemConfig(key, value);
  }

  async hasMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<boolean> {
    return systemRepository.hasMissingClockNotification(date, employeeId, shiftId);
  }

  async createMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<void> {
    return systemRepository.createMissingClockNotification(date, employeeId, shiftId);
  }

  async clearOldMissingClockNotifications(beforeDate: string): Promise<void> {
    return systemRepository.clearOldMissingClockNotifications(beforeDate);
  }

  async getMissingClockNotificationsForDate(date: string): Promise<MissingClockNotification[]> {
    return systemRepository.getMissingClockNotificationsForDate(date);
  }

  async hasWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string): Promise<boolean> {
    return systemRepository.hasWeeklyPushNotification(weekStartDate, employeeId, pushType);
  }

  async createWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string): Promise<void> {
    return systemRepository.createWeeklyPushNotification(weekStartDate, employeeId, pushType);
  }

  async clearOldWeeklyPushNotifications(beforeWeekStart: string): Promise<void> {
    return systemRepository.clearOldWeeklyPushNotifications(beforeWeekStart);
  }

  async createLeaveRequest(data: InsertLeaveRequest): Promise<LeaveRequest> {
    return leaveRepository.createLeaveRequest(data);
  }

  async getLeaveRequests(status?: string): Promise<LeaveRequest[]> {
    return leaveRepository.getLeaveRequests(status);
  }

  async getLeaveRequestsByEmployee(employeeId: number): Promise<LeaveRequest[]> {
    return leaveRepository.getLeaveRequestsByEmployee(employeeId);
  }

  async getLeaveRequest(id: number): Promise<LeaveRequest | undefined> {
    return leaveRepository.getLeaveRequest(id);
  }

  async updateLeaveRequestStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<LeaveRequest | undefined> {
    return leaveRepository.updateLeaveRequestStatus(id, status, reviewedBy, reviewedByName, reviewNote);
  }

}

export const storage = new DatabaseStorage();

export async function ensureDispatchShiftsSoftDelete(): Promise<void> {
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

export async function ensureOutingRecordsTable(): Promise<void> {
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

export async function ensureShiftAvailabilitiesTable(): Promise<void> {
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

export async function ensureAvailabilityEntryTypeColumn(): Promise<void> {
  await pool.query(`
    ALTER TABLE shift_availabilities ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'available';
    ALTER TABLE shift_availabilities ALTER COLUMN start_time DROP NOT NULL;
    ALTER TABLE shift_availabilities ALTER COLUMN end_time DROP NOT NULL;
  `);
  console.log("[db] shift_availabilities entry_type 欄位確認完成");
}

export async function ensureVenueOperatingHoursColumns(): Promise<void> {
  await pool.query(`
    ALTER TABLE venues ADD COLUMN IF NOT EXISTS open_time TEXT;
    ALTER TABLE venues ADD COLUMN IF NOT EXISTS close_time TEXT;
  `);
  console.log("[db] venues open_time/close_time 欄位確認完成");
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
