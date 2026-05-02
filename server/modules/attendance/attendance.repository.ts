import { db } from "../../db";
import { eq, and, gte, lte, inArray, desc } from "drizzle-orm";
import {
  attendanceUploads,
  attendanceRecords,
  type AttendanceUpload,
  type InsertAttendanceUpload,
  type AttendanceRecord,
  type InsertAttendanceRecord,
} from "@shared/schema";

export const attendanceRepository = {
  async getAttendanceUploads(): Promise<AttendanceUpload[]> {
    return db.select().from(attendanceUploads).orderBy(desc(attendanceUploads.uploadedAt));
  },

  async createAttendanceUpload(data: InsertAttendanceUpload): Promise<AttendanceUpload> {
    const [upload] = await db.insert(attendanceUploads).values(data).returning();
    return upload;
  },

  async updateAttendanceUpload(id: number, data: Partial<InsertAttendanceUpload>): Promise<AttendanceUpload | undefined> {
    const [upload] = await db.update(attendanceUploads).set(data).where(eq(attendanceUploads.id, id)).returning();
    return upload;
  },

  async deleteAttendanceUpload(id: number): Promise<boolean> {
    const result = await db.delete(attendanceUploads).where(eq(attendanceUploads.id, id)).returning();
    return result.length > 0;
  },

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
  },

  async getAttendanceRecordsByUpload(uploadId: number): Promise<AttendanceRecord[]> {
    return db.select().from(attendanceRecords).where(eq(attendanceRecords.uploadId, uploadId));
  },

  async getAttendanceRecordsByDateRange(startDate: string, endDate: string, employeeCodes?: string[]): Promise<AttendanceRecord[]> {
    const conditions = [
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ];
    if (employeeCodes && employeeCodes.length > 0) {
      conditions.push(inArray(attendanceRecords.employeeCode, employeeCodes));
    }
    return db.select().from(attendanceRecords).where(and(...conditions));
  },

  async deleteAttendanceRecordsByUpload(uploadId: number): Promise<void> {
    await db.delete(attendanceRecords).where(eq(attendanceRecords.uploadId, uploadId));
  },

};
