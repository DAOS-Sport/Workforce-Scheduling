import { db } from "../../db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  clockRecords,
  clockAmendments,
  dispatchShifts,
  employees,
  shifts,
  venues,
  type ClockRecord,
  type InsertClockRecord,
  type ClockAmendment,
  type InsertClockAmendment,
} from "@shared/schema";

async function assertEmployeeExists(employeeId: number, label: string): Promise<void> {
  const [employee] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
  if (!employee) throw new Error(`Invalid clock ${label} ${employeeId}: employee does not exist`);
}

async function assertVenueExists(venueId: number | null | undefined, label: string): Promise<void> {
  if (venueId == null) return;
  const [venue] = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId));
  if (!venue) throw new Error(`Invalid clock ${label} ${venueId}: venue does not exist`);
}

async function assertShiftMatches(
  shiftId: number | null | undefined,
  employeeId: number,
  venueId: number | null | undefined,
  label: string,
  allowDispatch = false,
): Promise<void> {
  if (shiftId == null) return;
  if (shiftId < 0) {
    if (!allowDispatch) throw new Error(`Invalid clock ${label} ${shiftId}: dispatch shifts are not valid clock record shifts`);
    const dispatchId = Math.abs(shiftId);
    const [dispatch] = await db.select({
      id: dispatchShifts.id,
      linkedEmployeeId: dispatchShifts.linkedEmployeeId,
      venueId: dispatchShifts.venueId,
    }).from(dispatchShifts).where(eq(dispatchShifts.id, dispatchId));
    if (!dispatch) throw new Error(`Invalid clock ${label} ${shiftId}: dispatch shift does not exist`);
    if (dispatch.linkedEmployeeId !== employeeId) {
      throw new Error(`Invalid clock mapping: dispatch shift ${dispatchId} belongs to employee ${dispatch.linkedEmployeeId}, not ${employeeId}`);
    }
    if (venueId != null && dispatch.venueId !== venueId) {
      throw new Error(`Invalid clock mapping: dispatch shift ${dispatchId} belongs to venue ${dispatch.venueId}, not ${venueId}`);
    }
    return;
  }
  const [shift] = await db.select({ id: shifts.id, employeeId: shifts.employeeId, venueId: shifts.venueId }).from(shifts).where(eq(shifts.id, shiftId));
  if (!shift) throw new Error(`Invalid clock ${label} ${shiftId}: shift does not exist`);
  if (shift.employeeId !== employeeId) {
    throw new Error(`Invalid clock mapping: shift ${shiftId} belongs to employee ${shift.employeeId}, not ${employeeId}`);
  }
  if (venueId != null && shift.venueId !== venueId) {
    throw new Error(`Invalid clock mapping: shift ${shiftId} belongs to venue ${shift.venueId}, not ${venueId}`);
  }
}

async function assertClockRecordExists(clockRecordId: number | null | undefined, label: string): Promise<void> {
  if (clockRecordId == null) return;
  const [record] = await db.select({ id: clockRecords.id }).from(clockRecords).where(eq(clockRecords.id, clockRecordId));
  if (!record) throw new Error(`Invalid clock ${label} ${clockRecordId}: clock record does not exist`);
}

export const clockRepository = {
  async createClockRecord(data: InsertClockRecord): Promise<ClockRecord> {
    await assertEmployeeExists(data.employeeId, "employeeId");
    await assertVenueExists(data.venueId, "venueId");
    await assertShiftMatches(data.shiftId, data.employeeId, data.venueId, "shiftId", false);
    const [record] = await db.insert(clockRecords).values(data).returning();
    return record;
  },

  async getClockRecord(id: number): Promise<ClockRecord | undefined> {
    const [record] = await db.select().from(clockRecords).where(eq(clockRecords.id, id));
    return record;
  },

  async getClockRecordsByDateRange(startDate: string, endDate: string): Promise<ClockRecord[]> {
    return db.select().from(clockRecords).where(
      and(
        gte(clockRecords.clockTime, new Date(startDate + "T00:00:00+08:00")),
        lte(clockRecords.clockTime, new Date(endDate + "T23:59:59+08:00"))
      )
    ).orderBy(desc(clockRecords.clockTime));
  },

  async getClockRecordsByEmployee(employeeId: number, startDate: string, endDate: string): Promise<ClockRecord[]> {
    return db.select().from(clockRecords).where(
      and(
        eq(clockRecords.employeeId, employeeId),
        gte(clockRecords.clockTime, new Date(startDate + "T00:00:00+08:00")),
        lte(clockRecords.clockTime, new Date(endDate + "T23:59:59+08:00"))
      )
    ).orderBy(desc(clockRecords.clockTime));
  },

  async createClockAmendment(data: InsertClockAmendment): Promise<ClockAmendment> {
    await assertEmployeeExists(data.employeeId, "employeeId");
    await assertVenueExists(data.venueId, "venueId");
    await assertShiftMatches(data.shiftId, data.employeeId, data.venueId, "shiftId", true);
    await assertClockRecordExists(data.originalClockRecordId, "originalClockRecordId");
    const [record] = await db.insert(clockAmendments).values(data).returning();
    return record;
  },

  async getClockAmendments(status?: string): Promise<ClockAmendment[]> {
    if (status) {
      return db.select().from(clockAmendments)
        .where(eq(clockAmendments.status, status))
        .orderBy(desc(clockAmendments.createdAt));
    }
    return db.select().from(clockAmendments).orderBy(desc(clockAmendments.createdAt));
  },

  async getClockAmendmentsByEmployee(employeeId: number): Promise<ClockAmendment[]> {
    return db.select().from(clockAmendments)
      .where(eq(clockAmendments.employeeId, employeeId))
      .orderBy(desc(clockAmendments.createdAt));
  },

  async getClockAmendment(id: number): Promise<ClockAmendment | undefined> {
    const [record] = await db.select().from(clockAmendments).where(eq(clockAmendments.id, id));
    return record;
  },

  async updateClockAmendmentStatus(id: number, status: string, reviewedBy: number, reviewedByName: string, reviewNote?: string): Promise<ClockAmendment | undefined> {
    await assertEmployeeExists(reviewedBy, "reviewedBy");
    const [record] = await db.update(clockAmendments).set({
      status,
      reviewedBy,
      reviewedByName,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    }).where(eq(clockAmendments.id, id)).returning();
    return record;
  },

  async updateClockRecordReason(id: number, earlyArrivalReason?: string, lateDepartureReason?: string): Promise<ClockRecord | undefined> {
    const updates: Record<string, any> = {};
    if (earlyArrivalReason !== undefined) updates.earlyArrivalReason = earlyArrivalReason;
    if (lateDepartureReason !== undefined) updates.lateDepartureReason = lateDepartureReason;
    if (Object.keys(updates).length === 0) return undefined;
    const [record] = await db.update(clockRecords).set(updates).where(eq(clockRecords.id, id)).returning();
    return record;
  },

  async applyClockRecordAmendment(clockRecordId: number, amendedTime: Date, amendmentId: number, newFailReason: string | null): Promise<ClockRecord | undefined> {
    await assertClockRecordExists(clockRecordId, "clockRecordId");
    const [amendment] = await db.select({ id: clockAmendments.id }).from(clockAmendments).where(eq(clockAmendments.id, amendmentId));
    if (!amendment) throw new Error(`Invalid clock amendmentId ${amendmentId}: amendment does not exist`);
    const [record] = await db.update(clockRecords).set({
      amendedTime,
      amendmentId,
      failReason: newFailReason,
    }).where(eq(clockRecords.id, clockRecordId)).returning();
    return record;
  },

};
