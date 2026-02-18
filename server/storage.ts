import { db } from "./db";
import { eq, and, gte, lte, inArray, desc } from "drizzle-orm";
import {
  regions, venues, employees, shifts, venueRequirements,
  attendanceUploads, attendanceRecords,
  type Region, type InsertRegion,
  type Venue, type InsertVenue,
  type Employee, type InsertEmployee,
  type Shift, type InsertShift,
  type VenueRequirement, type InsertVenueRequirement,
  type AttendanceUpload, type InsertAttendanceUpload,
  type AttendanceRecord, type InsertAttendanceRecord,
} from "@shared/schema";

export interface IStorage {
  getRegions(): Promise<Region[]>;
  getRegionByCode(code: string): Promise<Region | undefined>;
  createRegion(data: InsertRegion): Promise<Region>;

  getVenuesByRegion(regionId: number): Promise<Venue[]>;
  getVenue(id: number): Promise<Venue | undefined>;
  createVenue(data: InsertVenue): Promise<Venue>;
  updateVenue(id: number, data: Partial<InsertVenue>): Promise<Venue | undefined>;

  getEmployeesByRegion(regionId: number): Promise<Employee[]>;
  getEmployee(id: number): Promise<Employee | undefined>;
  getEmployeeByCode(code: string): Promise<Employee | undefined>;
  createEmployee(data: InsertEmployee): Promise<Employee>;
  updateEmployee(id: number, data: Partial<InsertEmployee>): Promise<Employee | undefined>;

  getShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<Shift[]>;
  getShiftsByEmployee(employeeId: number): Promise<Shift[]>;
  getShift(id: number): Promise<Shift | undefined>;
  createShift(data: InsertShift): Promise<Shift>;
  updateShift(id: number, data: Partial<InsertShift>): Promise<Shift | undefined>;
  deleteShift(id: number): Promise<boolean>;

  getVenueRequirementsByRegion(regionId: number): Promise<VenueRequirement[]>;
  createVenueRequirement(data: InsertVenueRequirement): Promise<VenueRequirement>;

  getAttendanceUploads(): Promise<AttendanceUpload[]>;
  createAttendanceUpload(data: InsertAttendanceUpload): Promise<AttendanceUpload>;
  updateAttendanceUpload(id: number, data: Partial<InsertAttendanceUpload>): Promise<AttendanceUpload | undefined>;
  deleteAttendanceUpload(id: number): Promise<boolean>;
  createAttendanceRecords(records: InsertAttendanceRecord[]): Promise<AttendanceRecord[]>;
  getAttendanceRecordsByUpload(uploadId: number): Promise<AttendanceRecord[]>;
  getAttendanceRecordsByDateRange(startDate: string, endDate: string, employeeCodes?: string[]): Promise<AttendanceRecord[]>;
  deleteAttendanceRecordsByUpload(uploadId: number): Promise<void>;
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
        lte(shifts.date, endDate)
      )
    );
  }

  async getShiftsByEmployee(employeeId: number): Promise<Shift[]> {
    return db.select().from(shifts).where(eq(shifts.employeeId, employeeId));
  }

  async getShift(id: number): Promise<Shift | undefined> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, id));
    return shift;
  }

  async createShift(data: InsertShift): Promise<Shift> {
    const [shift] = await db.insert(shifts).values(data).returning();
    return shift;
  }

  async updateShift(id: number, data: Partial<InsertShift>): Promise<Shift | undefined> {
    const [shift] = await db.update(shifts).set(data).where(eq(shifts.id, id)).returning();
    return shift;
  }

  async deleteShift(id: number): Promise<boolean> {
    const result = await db.delete(shifts).where(eq(shifts.id, id)).returning();
    return result.length > 0;
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
}

export const storage = new DatabaseStorage();
