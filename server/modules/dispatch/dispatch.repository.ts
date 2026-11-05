import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, gte, lte, isNull, isNotNull, ne, sql } from "drizzle-orm";
import {
  dispatchShifts,
  type DispatchShift,
  type InsertDispatchShift,
} from "@shared/schema";

export const dispatchRepository = {
  async createDispatchShift(data: InsertDispatchShift, tx: Executor = db): Promise<DispatchShift> {
    const [record] = await tx.insert(dispatchShifts).values(data).returning();
    return record;
  },

  /** One multi-row INSERT, so the batch is written whole or not at all. */
  async batchCreateDispatchShifts(data: InsertDispatchShift[], tx: Executor = db): Promise<DispatchShift[]> {
    if (data.length === 0) return [];
    return tx.insert(dispatchShifts).values(data).returning();
  },

  /**
   * Creates the dispatch shift unless a live one for the same person, venue, day, time and role already
   * exists. Callers hold the lock that serializes writers of that person.
   */
  async createDispatchShiftIfAbsent(data: InsertDispatchShift, tx: Executor = db): Promise<{ shift: DispatchShift; created: boolean }> {
    const [existing] = await tx.select().from(dispatchShifts).where(
      and(
        eq(dispatchShifts.regionId, data.regionId),
        data.venueId == null ? isNull(dispatchShifts.venueId) : eq(dispatchShifts.venueId, data.venueId),
        eq(dispatchShifts.date, data.date),
        sql`substring(${dispatchShifts.startTime} from 1 for 5) = ${data.startTime.substring(0, 5)}`,
        sql`substring(${dispatchShifts.endTime} from 1 for 5) = ${data.endTime.substring(0, 5)}`,
        eq(dispatchShifts.dispatchName, data.dispatchName),
        eq(dispatchShifts.role, data.role ?? "救生"),
        ne(dispatchShifts.status, "cancelled"),
      ),
    ).orderBy(dispatchShifts.id).limit(1);
    if (existing) return { shift: existing, created: false };
    const [shift] = await tx.insert(dispatchShifts).values(data).returning();
    return { shift, created: true };
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

  /** Every dispatch shift in the range that is linked to an employee, cancelled ones included (the salary report counts them as it always has). */
  async getLinkedDispatchShiftsInRange(startDate: string, endDate: string, tx: Executor = db): Promise<DispatchShift[]> {
    return tx.select().from(dispatchShifts).where(
      and(gte(dispatchShifts.date, startDate), lte(dispatchShifts.date, endDate), isNotNull(dispatchShifts.linkedEmployeeId)),
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

  /**
   * Links an unlinked dispatch shift to the one active employee who has that name (surrounding spaces ignored).
   * A name shared by two active employees is left unlinked. One statement, so a concurrent run cannot interleave.
   */
  async reconcileDispatchLinks(tx: Executor = db): Promise<number> {
    const blank = sql.raw(`E' \t\r\n\u00a0\u3000'`);
    const result = await tx.execute(sql`
      update dispatch_shifts ds set linked_employee_id = e.id
      from (
        select btrim(name, ${blank}) as name, min(id) as id
        from employees
        where status = 'active'
        group by btrim(name, ${blank})
        having count(*) = 1
      ) e
      where ds.linked_employee_id is null
        and btrim(ds.dispatch_name, ${blank}) = e.name
      returning ds.id`);
    return result.rows.length;
  },

};
