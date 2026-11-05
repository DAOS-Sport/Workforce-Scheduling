import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { httpError } from "../../shared/errors";
import { eq, and, gte, lte, inArray, desc, not, like, or, isNull } from "drizzle-orm";
import {
  shifts,
  shiftAuditLog,
  employees,
  venues,
  type Shift,
  type InsertShift,
  type ShiftAuditLog,
} from "@shared/schema";

/**
 * A write and its audit row commit together. Called with the shared `db` this opens a transaction; called with
 * a transaction it opens a savepoint, so the caller's own transaction still decides the final commit.
 */
const atomic = <T>(tx: Executor, fn: (inner: Executor) => Promise<T>): Promise<T> => tx.transaction((inner) => fn(inner));

export const shiftRepository = {
  async getShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string, tx: Executor = db): Promise<Shift[]> {
    return tx.select().from(shifts).where(
      and(
        inArray(shifts.employeeId, tx.select({ id: employees.id }).from(employees).where(eq(employees.regionId, regionId))),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active"),
        or(
          isNull(shifts.notes),
          not(like(shifts.notes, "%暑假排班v40%")),
          like(shifts.notes, "%暑假救生排班%"),
          like(shifts.notes, "%暑假櫃台排班%")
        )
      )
    );
  },

  async getDispatchedShiftsToRegion(regionId: number, startDate: string, endDate: string, tx: Executor = db): Promise<Shift[]> {
    return tx.select().from(shifts).where(
      and(
        inArray(shifts.venueId, tx.select({ id: venues.id }).from(venues).where(eq(venues.regionId, regionId))),
        eq(shifts.isDispatch, true),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active"),
        or(
          isNull(shifts.notes),
          not(like(shifts.notes, "%暑假排班v40%")),
          like(shifts.notes, "%暑假救生排班%"),
          like(shifts.notes, "%暑假櫃台排班%")
        )
      )
    );
  },

  async getShiftsByDate(date: string, tx: Executor = db): Promise<Shift[]> {
    return tx.select().from(shifts).where(
      and(eq(shifts.date, date), eq(shifts.status, "active"))
    );
  },

  async getAllShiftsByDateRange(startDate: string, endDate: string, tx: Executor = db): Promise<Shift[]> {
    return tx.select().from(shifts).where(
      and(
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  },

  async getShiftsByEmployee(employeeId: number, tx: Executor = db): Promise<Shift[]> {
    return tx.select().from(shifts).where(
      and(eq(shifts.employeeId, employeeId), eq(shifts.status, "active"))
    );
  },

  async getShift(id: number, tx: Executor = db): Promise<Shift | undefined> {
    const [shift] = await tx.select().from(shifts).where(eq(shifts.id, id));
    return shift;
  },

  /** Reads the row and holds it until the transaction ends, so the caller's decision cannot be overtaken. */
  async getShiftForUpdate(id: number, tx: Executor = db): Promise<Shift | undefined> {
    const [shift] = await tx.select().from(shifts).where(eq(shifts.id, id)).for("update");
    return shift;
  },

  async createShift(data: InsertShift, actor: string = "system", tx: Executor = db): Promise<Shift> {
    return atomic(tx, async (t) => {
      const [shift] = await t.insert(shifts).values(data).returning();
      await t.insert(shiftAuditLog).values({
        shiftId: shift.id,
        action: "create",
        actor,
        payload: { after: shift },
      });
      return shift;
    });
  },

  async updateShift(id: number, data: Partial<InsertShift>, actor: string = "system", force: boolean = false, tx: Executor = db): Promise<Shift | undefined> {
    return atomic(tx, async (t) => {
      const before = await shiftRepository.getShiftForUpdate(id, t);
      // Task #50 protection: any caller mutating an active shift MUST explicitly
      // opt in with force=true. Admin UI routes set force=true (admin chose to
      // edit). Automation paths (ragic-sync etc.) default to force=false so they
      // cannot silently overwrite admin-confirmed shifts.
      if (before?.status === "active" && !force) {
        throw httpError(400, `actor '${actor}' refused to mutate active shift ${id} without force=true (Task #50 protection)`);
      }
      const [shift] = await t.update(shifts).set(data).where(eq(shifts.id, id)).returning();
      if (!shift) return undefined;
      await t.insert(shiftAuditLog).values({
        shiftId: id,
        action: "update",
        actor,
        payload: { before, after: shift, changes: data },
      });
      return shift;
    });
  },

  async deleteShift(id: number, actor: string = "system", reason?: string, force: boolean = false, tx: Executor = db): Promise<boolean> {
    return atomic(tx, async (t) => {
      const before = await shiftRepository.getShiftForUpdate(id, t);
      if (!before || before.status === "cancelled") return false;
      // Task #50 protection: explicit force=true required to cancel any active shift.
      if (!force) {
        throw httpError(400, `actor '${actor}' refused to cancel active shift ${id} without force=true (Task #50 protection)`);
      }
      const [shift] = await t.update(shifts).set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: actor,
        cancelReason: reason ?? null,
      }).where(and(eq(shifts.id, id), eq(shifts.status, "active"))).returning();
      if (!shift) return false;
      await t.insert(shiftAuditLog).values({
        shiftId: id,
        action: "cancel",
        actor,
        payload: { before, reason: reason ?? null },
      });
      return true;
    });
  },

  /**
   * restoreShift intentionally has NO `force` gate.
   *
   * Task #50 protection guards against destructive mutations on *active* rows
   * (active → modified or active → cancelled).  Restoring an already-cancelled
   * shift back to active is non-destructive: the original row is recreated
   * verbatim from its own pre-cancel state and a `restore` audit row is written.
   * Requiring `force=true` here would block legitimate "undo" UX without
   * adding any safety, so the gate is omitted by design.
   *
   * The update only matches a row that is still cancelled, so two restores at once restore once.
   * The labor-law check before a restore is the service's job (restoreShift in shift.service).
   */
  async restoreShift(id: number, actor: string = "system", tx: Executor = db): Promise<Shift | undefined> {
    return atomic(tx, async (t) => {
      const before = await shiftRepository.getShiftForUpdate(id, t);
      if (!before || before.status !== "cancelled") return undefined;
      const [shift] = await t.update(shifts).set({
        status: "active",
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
      }).where(and(eq(shifts.id, id), eq(shifts.status, "cancelled"))).returning();
      if (!shift) return undefined;
      await t.insert(shiftAuditLog).values({
        shiftId: id,
        action: "restore",
        actor,
        payload: { before, after: shift },
      });
      return shift;
    });
  },

  async getShiftAuditLog(shiftId: number, tx: Executor = db): Promise<ShiftAuditLog[]> {
    return tx.select().from(shiftAuditLog)
      .where(eq(shiftAuditLog.shiftId, shiftId))
      .orderBy(desc(shiftAuditLog.createdAt));
  },

  async getCancelledShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string, tx: Executor = db): Promise<Shift[]> {
    return tx.select().from(shifts).where(
      and(
        inArray(shifts.employeeId, tx.select({ id: employees.id }).from(employees).where(eq(employees.regionId, regionId))),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "cancelled")
      )
    );
  },

  /** In id order, so "the day's shift" means the same row on every call. */
  async getShiftsByEmployeeAndDateRange(employeeId: number, startDate: string, endDate: string, tx: Executor = db): Promise<Shift[]> {
    return tx.select().from(shifts).where(
      and(
        eq(shifts.employeeId, employeeId),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    ).orderBy(shifts.id);
  },

  async getShiftsByEmployeesAndDateRange(employeeIds: number[], startDate: string, endDate: string, tx: Executor = db): Promise<Shift[]> {
    if (employeeIds.length === 0) return [];
    return tx.select().from(shifts).where(
      and(
        inArray(shifts.employeeId, employeeIds),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  },

  async getShiftsByVenueAndDate(venueId: number, date: string, tx: Executor = db): Promise<Shift[]> {
    return tx.select().from(shifts).where(
      and(
        eq(shifts.venueId, venueId),
        eq(shifts.date, date),
        eq(shifts.status, "active")
      )
    );
  },

};
