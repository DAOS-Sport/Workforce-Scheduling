import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, gte, lte, isNull, ne } from "drizzle-orm";
import {
  dispatchShifts,
  employees,
  type DispatchShift,
  type InsertDispatchShift,
} from "@shared/schema";

export const dispatchRepository = {
  async createDispatchShift(data: InsertDispatchShift, tx: Executor = db): Promise<DispatchShift> {
    const [record] = await tx.insert(dispatchShifts).values(data).returning();
    return record;
  },

  async batchCreateDispatchShifts(data: InsertDispatchShift[], tx: Executor = db): Promise<DispatchShift[]> {
    if (data.length === 0) return [];
    const results: DispatchShift[] = [];
    for (const item of data) {
      const [record] = await tx.insert(dispatchShifts).values(item).returning();
      results.push(record);
    }
    return results;
  },

  async getDispatchShifts(regionId: number, startDate: string, endDate: string, tx: Executor = db): Promise<DispatchShift[]> {
    return tx.select().from(dispatchShifts)
      .where(and(
        eq(dispatchShifts.regionId, regionId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
        ne(dispatchShifts.status, "cancelled"),
      ));
  },

  async getDispatchShiftsByDate(date: string, tx: Executor = db): Promise<DispatchShift[]> {
    return tx.select().from(dispatchShifts).where(
      and(
        eq(dispatchShifts.date, date),
        ne(dispatchShifts.status, "cancelled"),
      ),
    );
  },

  async getDispatchShiftsByLinkedEmployee(employeeId: number, startDate: string, endDate: string, tx: Executor = db): Promise<DispatchShift[]> {
    return tx.select().from(dispatchShifts).where(
      and(
        eq(dispatchShifts.linkedEmployeeId, employeeId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
        ne(dispatchShifts.status, "cancelled"),
      )
    );
  },

  async getDispatchShift(id: number, tx: Executor = db): Promise<DispatchShift | undefined> {
    const [record] = await tx.select().from(dispatchShifts).where(eq(dispatchShifts.id, id));
    return record;
  },

  async updateDispatchShift(id: number, data: Partial<InsertDispatchShift>, tx: Executor = db): Promise<DispatchShift | undefined> {
    const [record] = await tx.update(dispatchShifts).set(data).where(eq(dispatchShifts.id, id)).returning();
    return record;
  },

  async deleteDispatchShift(id: number, actor = "admin", reason?: string, tx: Executor = db): Promise<boolean> {
    const [existing] = await tx.select().from(dispatchShifts).where(eq(dispatchShifts.id, id));
    if (!existing || existing.status === "cancelled") return false;
    await tx.update(dispatchShifts)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: actor, cancelReason: reason || null })
      .where(eq(dispatchShifts.id, id));
    return true;
  },

  async restoreDispatchShift(id: number, actor = "admin", tx: Executor = db): Promise<DispatchShift | undefined> {
    const [existing] = await tx.select().from(dispatchShifts).where(eq(dispatchShifts.id, id));
    if (!existing || existing.status !== "cancelled") return undefined;
    const [restored] = await tx.update(dispatchShifts)
      .set({ status: "active", cancelledAt: null, cancelledBy: null, cancelReason: null })
      .where(eq(dispatchShifts.id, id))
      .returning();
    return restored;
  },

  async getCancelledDispatchShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string, tx: Executor = db): Promise<DispatchShift[]> {
    return tx.select().from(dispatchShifts)
      .where(and(
        eq(dispatchShifts.regionId, regionId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
        eq(dispatchShifts.status, "cancelled"),
      ));
  },

  async reconcileDispatchLinks(tx: Executor = db): Promise<number> {
    const activeEmployees = await tx.select().from(employees).where(eq(employees.status, "active"));
    const nameToId = new Map<string, number>();
    for (const emp of activeEmployees) {
      nameToId.set(emp.name.trim(), emp.id);
    }
    const unlinked = await tx.select().from(dispatchShifts).where(isNull(dispatchShifts.linkedEmployeeId));
    let count = 0;
    for (const ds of unlinked) {
      if (!ds.dispatchName) continue;
      const empId = nameToId.get(ds.dispatchName.trim());
      if (empId) {
        await tx.update(dispatchShifts).set({ linkedEmployeeId: empId }).where(eq(dispatchShifts.id, ds.id));
        count++;
      }
    }
    return count;
  },

};
