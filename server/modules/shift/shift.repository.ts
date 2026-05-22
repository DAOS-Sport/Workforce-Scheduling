import { db } from "../../db";
import { eq, and, gte, lte, inArray, desc } from "drizzle-orm";
import {
  employees,
  shifts,
  shiftAuditLog,
  venues,
  type Shift,
  type InsertShift,
  type ShiftAuditLog,
} from "@shared/schema";
import { normalizeScheduleRole } from "@shared/scheduleMapping";
import { venueRepository } from "../venue/venue.repository";
import { isLeaveRole } from "./shift.types";

function normalizeShiftRoleData<T extends Partial<InsertShift>>(data: T): T {
  if (data.role === undefined) return data;
  return { ...data, role: normalizeScheduleRole(data.role) || data.role } as T;
}

async function assertShiftReferences(data: Pick<InsertShift, "employeeId" | "venueId" | "role">): Promise<void> {
  const [[employee], [venue]] = await Promise.all([
    db.select({ id: employees.id, regionId: employees.regionId, status: employees.status }).from(employees).where(eq(employees.id, data.employeeId)),
    db.select({ id: venues.id, regionId: venues.regionId }).from(venues).where(eq(venues.id, data.venueId)),
  ]);
  if (!employee) throw new Error(`Invalid shift employeeId ${data.employeeId}: employee does not exist`);
  if (!venue) throw new Error(`Invalid shift venueId ${data.venueId}: venue does not exist`);
  if (employee.status !== "active") {
    throw new Error(`Invalid shift employeeId ${data.employeeId}: employee status is ${employee.status}`);
  }
  if (!isLeaveRole(data.role) && employee.regionId !== venue.regionId) {
    throw new Error(`Invalid shift mapping: employee ${data.employeeId} region ${employee.regionId} does not match venue ${data.venueId} region ${venue.regionId}`);
  }
}

export const shiftRepository = {
  async getShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    const regionVenues = await venueRepository.getVenuesByRegion(regionId);
    const venueIds = regionVenues.map((v) => v.id);
    if (venueIds.length === 0) return [];

    return db.select().from(shifts).where(
      and(
        inArray(shifts.venueId, venueIds),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  },

  async getDispatchedShiftsToRegion(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    const regionVenues = await venueRepository.getVenuesByRegion(regionId);
    const venueIds = regionVenues.map(v => v.id);
    if (venueIds.length === 0) return [];

    return db.select().from(shifts).where(
      and(
        inArray(shifts.venueId, venueIds),
        eq(shifts.isDispatch, true),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  },

  async getShiftsByDate(date: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(eq(shifts.date, date), eq(shifts.status, "active"))
    );
  },

  async getAllShiftsByDateRange(startDate: string, endDate: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  },

  async getShiftsByEmployee(employeeId: number): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(eq(shifts.employeeId, employeeId), eq(shifts.status, "active"))
    );
  },

  async getShift(id: number): Promise<Shift | undefined> {
    const [shift] = await db.select().from(shifts).where(eq(shifts.id, id));
    return shift;
  },

  async createShift(data: InsertShift, actor: string = "system"): Promise<Shift> {
    const normalizedData = normalizeShiftRoleData(data);
    await assertShiftReferences(normalizedData);
    const [shift] = await db.insert(shifts).values(normalizedData).returning();
    if (shift) {
      try {
        await db.insert(shiftAuditLog).values({
          shiftId: shift.id,
          action: "create",
          actor,
          payload: { after: shift },
        });
      } catch (e) {
        console.error("[shift-audit] create log failed", e);
      }
    }
    return shift;
  },

  async updateShift(id: number, data: Partial<InsertShift>, actor: string = "system", force: boolean = false): Promise<Shift | undefined> {
    const before = await shiftRepository.getShift(id);
    // Task #50 protection: any caller mutating an active shift MUST explicitly
    // opt in with force=true. Admin UI routes set force=true (admin chose to
    // edit). Automation paths (ragic-sync etc.) default to force=false so they
    // cannot silently overwrite admin-confirmed shifts.
    if (before?.status === "active" && !force) {
      throw new Error(`actor '${actor}' refused to mutate active shift ${id} without force=true (Task #50 protection)`);
    }
    const normalizedData = normalizeShiftRoleData(data);
    if (before) {
      await assertShiftReferences({
        employeeId: normalizedData.employeeId ?? before.employeeId,
        venueId: normalizedData.venueId ?? before.venueId,
        role: normalizedData.role ?? before.role,
      });
    }
    const [shift] = await db.update(shifts).set(normalizedData).where(eq(shifts.id, id)).returning();
    if (shift) {
      try {
        await db.insert(shiftAuditLog).values({
          shiftId: id,
          action: "update",
          actor,
          payload: { before, after: shift, changes: normalizedData },
        });
      } catch (e) {
        console.error("[shift-audit] update log failed", e);
      }
    }
    return shift;
  },

  async deleteShift(id: number, actor: string = "system", reason?: string, force: boolean = false): Promise<boolean> {
    const before = await shiftRepository.getShift(id);
    if (!before || before.status === "cancelled") return false;
    // Task #50 protection: explicit force=true required to cancel any active shift.
    if (!force) {
      throw new Error(`actor '${actor}' refused to cancel active shift ${id} without force=true (Task #50 protection)`);
    }
    const [shift] = await db.update(shifts).set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: actor,
      cancelReason: reason ?? null,
    }).where(and(eq(shifts.id, id), eq(shifts.status, "active"))).returning();
    if (!shift) return false;
    try {
      await db.insert(shiftAuditLog).values({
        shiftId: id,
        action: "cancel",
        actor,
        payload: { before, reason: reason ?? null },
      });
    } catch (e) {
      console.error("[shift-audit] cancel log failed", e);
    }
    return true;
  },

  /**
   * restoreShift intentionally has NO `force` gate.
   *
   * Task #50 protection guards against destructive mutations on *active* rows
   * (active → modified or active → cancelled).  Restoring an already-cancelled
   * shift back to active is non-destructive: the original row is recreated
   * verbatim from its own pre-cancel state and a `restore` audit row is written.
   * Requiring `force=true` here would block legitimate "undo" UX without
   * adding any safety, so the gate is omitted by design.  Behavior is
   * byte-identical to the pre-refactor implementation in storage.ts.
   */
  async restoreShift(id: number, actor: string = "system"): Promise<Shift | undefined> {
    const before = await shiftRepository.getShift(id);
    if (!before || before.status !== "cancelled") return undefined;
    const [shift] = await db.update(shifts).set({
      status: "active",
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
    }).where(eq(shifts.id, id)).returning();
    if (shift) {
      try {
        await db.insert(shiftAuditLog).values({
          shiftId: id,
          action: "restore",
          actor,
          payload: { before, after: shift },
        });
      } catch (e) {
        console.error("[shift-audit] restore log failed", e);
      }
    }
    return shift;
  },

  async getShiftAuditLog(shiftId: number): Promise<ShiftAuditLog[]> {
    return db.select().from(shiftAuditLog)
      .where(eq(shiftAuditLog.shiftId, shiftId))
      .orderBy(desc(shiftAuditLog.createdAt));
  },

  async getCancelledShiftsByRegionAndDateRange(regionId: number, startDate: string, endDate: string): Promise<Shift[]> {
    const regionVenues = await venueRepository.getVenuesByRegion(regionId);
    const venueIds = regionVenues.map((v) => v.id);
    if (venueIds.length === 0) return [];
    return db.select().from(shifts).where(
      and(
        inArray(shifts.venueId, venueIds),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "cancelled")
      )
    );
  },

  async getShiftsByEmployeeAndDateRange(employeeId: number, startDate: string, endDate: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(
        eq(shifts.employeeId, employeeId),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  },

  async getShiftsByEmployeesAndDateRange(employeeIds: number[], startDate: string, endDate: string): Promise<Shift[]> {
    if (employeeIds.length === 0) return [];
    return db.select().from(shifts).where(
      and(
        inArray(shifts.employeeId, employeeIds),
        gte(shifts.date, startDate),
        lte(shifts.date, endDate),
        eq(shifts.status, "active")
      )
    );
  },

  async getShiftsByVenueAndDate(venueId: number, date: string): Promise<Shift[]> {
    return db.select().from(shifts).where(
      and(
        eq(shifts.venueId, venueId),
        eq(shifts.date, date),
        eq(shifts.status, "active")
      )
    );
  },

};
