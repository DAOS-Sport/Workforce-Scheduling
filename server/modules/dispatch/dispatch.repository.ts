import { db } from "../../db";
import { eq, and, gte, lte, isNull, ne } from "drizzle-orm";
import {
  dispatchShifts,
  employees,
  regions,
  venues,
  type DispatchShift,
  type InsertDispatchShift,
} from "@shared/schema";
import { normalizeScheduleRole } from "@shared/scheduleMapping";

function normalizeDispatchRoleData<T extends Partial<InsertDispatchShift>>(data: T): T {
  if (data.role === undefined) return data;
  return { ...data, role: normalizeScheduleRole(data.role) || data.role } as T;
}

function hasField<T extends object, K extends PropertyKey>(obj: T, key: K): obj is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

async function assertDispatchReferences(data: {
  regionId: number;
  venueId?: number | null;
  linkedEmployeeId?: number | null;
}): Promise<void> {
  const [[region], venueRows, employeeRows] = await Promise.all([
    db.select({ id: regions.id }).from(regions).where(eq(regions.id, data.regionId)),
    data.venueId == null
      ? Promise.resolve([])
      : db.select({ id: venues.id, regionId: venues.regionId }).from(venues).where(eq(venues.id, data.venueId)),
    data.linkedEmployeeId == null
      ? Promise.resolve([])
      : db.select({ id: employees.id, status: employees.status }).from(employees).where(eq(employees.id, data.linkedEmployeeId)),
  ]);
  if (!region) throw new Error(`Invalid dispatch regionId ${data.regionId}: region does not exist`);
  const venue = venueRows[0];
  if (data.venueId != null && !venue) throw new Error(`Invalid dispatch venueId ${data.venueId}: venue does not exist`);
  if (venue && venue.regionId !== data.regionId) {
    throw new Error(`Invalid dispatch mapping: venue ${data.venueId} region ${venue.regionId} does not match dispatch region ${data.regionId}`);
  }
  if (data.linkedEmployeeId != null && !employeeRows[0]) {
    throw new Error(`Invalid dispatch linkedEmployeeId ${data.linkedEmployeeId}: employee does not exist`);
  }
  if (employeeRows[0] && employeeRows[0].status !== "active") {
    throw new Error(`Invalid dispatch linkedEmployeeId ${data.linkedEmployeeId}: employee status is ${employeeRows[0].status}`);
  }
}

export const dispatchRepository = {
  async createDispatchShift(data: InsertDispatchShift): Promise<DispatchShift> {
    const normalizedData = normalizeDispatchRoleData(data);
    await assertDispatchReferences(normalizedData);
    const [record] = await db.insert(dispatchShifts).values(normalizedData).returning();
    return record;
  },

  async batchCreateDispatchShifts(data: InsertDispatchShift[]): Promise<DispatchShift[]> {
    if (data.length === 0) return [];
    const results: DispatchShift[] = [];
    for (const item of data) {
      const normalizedData = normalizeDispatchRoleData(item);
      await assertDispatchReferences(normalizedData);
      const [record] = await db.insert(dispatchShifts).values(normalizedData).returning();
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
    return db.select().from(dispatchShifts).where(
      and(
        eq(dispatchShifts.date, date),
        ne(dispatchShifts.status, "cancelled"),
      )
    );
  },

  async getDispatchShiftsByLinkedEmployee(employeeId: number, startDate: string, endDate: string): Promise<DispatchShift[]> {
    return db.select().from(dispatchShifts).where(
      and(
        eq(dispatchShifts.linkedEmployeeId, employeeId),
        gte(dispatchShifts.date, startDate),
        lte(dispatchShifts.date, endDate),
        ne(dispatchShifts.status, "cancelled"),
      )
    );
  },

  async getDispatchShift(id: number): Promise<DispatchShift | undefined> {
    const [record] = await db.select().from(dispatchShifts).where(eq(dispatchShifts.id, id));
    return record;
  },

  async updateDispatchShift(id: number, data: Partial<InsertDispatchShift>): Promise<DispatchShift | undefined> {
    const existing = await dispatchRepository.getDispatchShift(id);
    const normalizedData = normalizeDispatchRoleData(data);
    if (existing) {
      await assertDispatchReferences({
        regionId: normalizedData.regionId ?? existing.regionId,
        venueId: hasField(normalizedData, "venueId") ? normalizedData.venueId : existing.venueId,
        linkedEmployeeId: hasField(normalizedData, "linkedEmployeeId") ? normalizedData.linkedEmployeeId : existing.linkedEmployeeId,
      });
    }
    const [record] = await db.update(dispatchShifts).set(normalizedData).where(eq(dispatchShifts.id, id)).returning();
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
    const nameToIds = new Map<string, number[]>();
    for (const emp of activeEmployees) {
      const key = emp.name.trim();
      const ids = nameToIds.get(key) || [];
      ids.push(emp.id);
      nameToIds.set(key, ids);
    }
    const nameToId = new Map<string, number>();
    for (const [name, ids] of nameToIds) {
      if (ids.length === 1) nameToId.set(name, ids[0]);
    }
    const unlinked = await db.select().from(dispatchShifts).where(
      and(
        isNull(dispatchShifts.linkedEmployeeId),
        ne(dispatchShifts.status, "cancelled"),
      ),
    );
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
