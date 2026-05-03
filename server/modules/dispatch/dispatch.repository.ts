import { db } from "../../db";
import { eq, and, gte, lte, isNull, ne } from "drizzle-orm";
import {
  dispatchShifts,
  employees,
  type DispatchShift,
  type InsertDispatchShift,
} from "@shared/schema";

export const dispatchRepository = {
  async createDispatchShift(data: InsertDispatchShift): Promise<DispatchShift> {
    const [record] = await db.insert(dispatchShifts).values(data).returning();
    return record;
  },

  async batchCreateDispatchShifts(data: InsertDispatchShift[]): Promise<DispatchShift[]> {
    if (data.length === 0) return [];
    const results: DispatchShift[] = [];
    for (const item of data) {
      const [record] = await db.insert(dispatchShifts).values(item).returning();
      results.push(record);
    }
    return results;
  },

  async getDispatchShifts(regionId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return db.select().from(dispatchShifts)
      .where(and(
        eq(dispatchShifts.regionId, regionId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
        ne(dispatchShifts.status, "cancelled"),
      ));
  },

  async getDispatchShiftsByDate(date: string): Promise<DispatchShift[]> {
    return db.select().from(dispatchShifts).where(eq(dispatchShifts.date, date));
  },

  async getDispatchShiftsByLinkedEmployee(employeeId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return db.select().from(dispatchShifts).where(
      and(
        eq(dispatchShifts.linkedEmployeeId, employeeId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
      )
    );
  },

  async getDispatchShift(id: number): Promise<DispatchShift | undefined> {
    const [record] = await db.select().from(dispatchShifts).where(eq(dispatchShifts.id, id));
    return record;
  },

  async updateDispatchShift(id: number, data: Partial<InsertDispatchShift>): Promise<DispatchShift | undefined> {
    const [record] = await db.update(dispatchShifts).set(data).where(eq(dispatchShifts.id, id)).returning();
    return record;
  },

  async deleteDispatchShift(id: number, actor = "admin", reason?: string): Promise<boolean> {
    const [existing] = await db.select().from(dispatchShifts).where(eq(dispatchShifts.id, id));
    if (!existing || existing.status === "cancelled") return false;
    await db.update(dispatchShifts)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor, cancelReason: reason || null })
      .where(eq(dispatchShifts.id, id));
    return true;
  },

  async restoreDispatchShift(id: number, actor = "admin"): Promise<DispatchShift | undefined> {
    const [existing] = await db.select().from(dispatchShifts).where(eq(dispatchShifts.id, id));
    if (!existing || existing.status !== "cancelled") return undefined;
    const [restored] = await db.update(dispatchShifts)
      .set({ status: "active", cancelledAt: null, cancelledBy: null, cancelReason: null })
      .where(eq(dispatchShifts.id, id))
      .returning();
    return restored;
  },

  async getCancelledDispatchShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return db.select().from(dispatchShifts)
      .where(and(
        eq(dispatchShifts.regionId, regionId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
        eq(dispatchShifts.status, "cancelled"),
      ));
  },

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
  },

};
