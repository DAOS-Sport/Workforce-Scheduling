import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
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
  async getAttendanceUploads(tx: Executor = db): Promise<AttendanceUpload[]> {
    return tx.select().from(attendanceUploads).orderBy(desc(attendanceUploads.uploadedAt));
  },

  async getAttendanceUpload(id: number, tx: Executor = db): Promise<AttendanceUpload | undefined> {
    const [upload] = await tx.select().from(attendanceUploads).where(eq(attendanceUploads.id, id));
    return upload;
  },

  async createAttendanceUpload(data: InsertAttendanceUpload, tx: Executor = db): Promise<AttendanceUpload> {
    const [upload] = await tx.insert(attendanceUploads).values(data).returning();
    return upload;
  },

  async updateAttendanceUpload(id: number, data: Partial<InsertAttendanceUpload>, tx: Executor = db): Promise<AttendanceUpload | undefined> {
    const [upload] = await tx.update(attendanceUploads).set(data).where(eq(attendanceUploads.id, id)).returning();
    return upload;
  },

  async deleteAttendanceUpload(id: number, tx: Executor = db): Promise<boolean> {
    const result = await tx.delete(attendanceUploads).where(eq(attendanceUploads.id, id)).returning();
    return result.length > 0;
  },

  async createAttendanceRecords(records: InsertAttendanceRecord[], tx: Executor = db): Promise<AttendanceRecord[]> {
    if (records.length === 0) return [];
    const batchSize = 100;
    const allResults: AttendanceRecord[] = [];
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const results = await tx.insert(attendanceRecords).values(batch).returning();
      allResults.push(...results);
    }
    return allResults;
  },

  async getAttendanceRecordsByUpload(uploadId: number, tx: Executor = db): Promise<AttendanceRecord[]> {
    return tx.select().from(attendanceRecords).where(eq(attendanceRecords.uploadId, uploadId));
  },

  async getAttendanceRecordsByDateRange(startDate: string, endDate: string, employeeCodes?: string[], tx: Executor = db): Promise<AttendanceRecord[]> {
    const conditions = [
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ];
    if (employeeCodes && employeeCodes.length > 0) {
      conditions.push(inArray(attendanceRecords.employeeCode, employeeCodes));
    }
    return tx.select().from(attendanceRecords).where(and(...conditions));
  },

  async deleteAttendanceRecordsByUpload(uploadId: number, tx: Executor = db): Promise<void> {
    await tx.delete(attendanceRecords).where(eq(attendanceRecords.uploadId, uploadId));
  },

};
