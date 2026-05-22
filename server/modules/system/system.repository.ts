import { db } from "../../db";
import { eq, and, lte } from "drizzle-orm";
import {
  employees,
  dispatchShifts,
  salaryRateConfigs,
  shifts,
  systemConfigs,
  missingClockNotifications,
  weeklyPushNotifications,
  type SalaryRateConfig,
  type SystemConfig,
  type MissingClockNotification,
  type WeeklyPushNotification,
} from "@shared/schema";
import { normalizeScheduleRole } from "@shared/scheduleMapping";

async function assertEmployeeExists(employeeId: number, label: string): Promise<void> {
  const [employee] = await db.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
  if (!employee) throw new Error(`Invalid notification ${label} ${employeeId}: employee does not exist`);
}

async function assertShiftMatchesEmployee(shiftId: number, employeeId: number): Promise<void> {
  if (shiftId < 0) {
    const dispatchId = Math.abs(shiftId);
    const [dispatchShift] = await db.select({ id: dispatchShifts.id, linkedEmployeeId: dispatchShifts.linkedEmployeeId })
      .from(dispatchShifts)
      .where(eq(dispatchShifts.id, dispatchId));
    if (!dispatchShift) throw new Error(`Invalid notification dispatch shiftId ${shiftId}: dispatch shift does not exist`);
    if (dispatchShift.linkedEmployeeId !== employeeId) {
      throw new Error(`Invalid notification mapping: dispatch shift ${dispatchId} belongs to employee ${dispatchShift.linkedEmployeeId}, not ${employeeId}`);
    }
    return;
  }
  const [shift] = await db.select({ id: shifts.id, employeeId: shifts.employeeId }).from(shifts).where(eq(shifts.id, shiftId));
  if (!shift) throw new Error(`Invalid notification shiftId ${shiftId}: shift does not exist`);
  if (shift.employeeId !== employeeId) {
    throw new Error(`Invalid notification mapping: shift ${shiftId} belongs to employee ${shift.employeeId}, not ${employeeId}`);
  }
}

export const systemRepository = {
  async getSalaryRates(): Promise<SalaryRateConfig[]> {
    return db.select().from(salaryRateConfigs).orderBy(salaryRateConfigs.role);
  },

  async upsertSalaryRate(role: string, ratePerHour: number, label?: string): Promise<SalaryRateConfig> {
    const normalizedRole = normalizeScheduleRole(role) || role;
    const existing = await db.select().from(salaryRateConfigs).where(eq(salaryRateConfigs.role, normalizedRole));
    if (existing.length > 0) {
      const [updated] = await db.update(salaryRateConfigs)
        .set({ ratePerHour, label, updatedAt: new Date() })
        .where(eq(salaryRateConfigs.role, normalizedRole))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(salaryRateConfigs)
        .values({ role: normalizedRole, ratePerHour, label })
        .returning();
      return created;
    }
  },

  async getSystemConfig(key: string): Promise<SystemConfig | undefined> {
    const [config] = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key));
    return config;
  },

  async upsertSystemConfig(key: string, value: string): Promise<SystemConfig> {
    const existing = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key));
    if (existing.length > 0) {
      const [updated] = await db.update(systemConfigs)
        .set({ value, updatedAt: new Date() })
        .where(eq(systemConfigs.key, key))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(systemConfigs)
        .values({ key, value })
        .returning();
      return created;
    }
  },

  async hasMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<boolean> {
    const [row] = await db.select({ id: missingClockNotifications.id })
      .from(missingClockNotifications)
      .where(and(
        eq(missingClockNotifications.date, date),
        eq(missingClockNotifications.employeeId, employeeId),
        eq(missingClockNotifications.shiftId, shiftId),
      ))
      .limit(1);
    return !!row;
  },

  async createMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<void> {
    await assertEmployeeExists(employeeId, "employeeId");
    await assertShiftMatchesEmployee(shiftId, employeeId);
    await db.insert(missingClockNotifications)
      .values({ date, employeeId, shiftId })
      .onConflictDoNothing();
  },

  async clearOldMissingClockNotifications(beforeDate: string): Promise<void> {
    await db.delete(missingClockNotifications)
      .where(and(
        // delete all records with date < beforeDate
        lte(missingClockNotifications.date, beforeDate),
      ));
  },

  async getMissingClockNotificationsForDate(date: string): Promise<MissingClockNotification[]> {
    return db.select().from(missingClockNotifications)
      .where(eq(missingClockNotifications.date, date));
  },

  async hasWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string): Promise<boolean> {
    const [row] = await db.select({ id: weeklyPushNotifications.id })
      .from(weeklyPushNotifications)
      .where(and(
        eq(weeklyPushNotifications.weekStartDate, weekStartDate),
        eq(weeklyPushNotifications.employeeId, employeeId),
        eq(weeklyPushNotifications.pushType, pushType),
      ))
      .limit(1);
    return !!row;
  },

  async createWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string): Promise<void> {
    await assertEmployeeExists(employeeId, "employeeId");
    await db.insert(weeklyPushNotifications)
      .values({ weekStartDate, employeeId, pushType })
      .onConflictDoNothing();
  },

  async clearOldWeeklyPushNotifications(beforeWeekStart: string): Promise<void> {
    await db.delete(weeklyPushNotifications)
      .where(lte(weeklyPushNotifications.weekStartDate, beforeWeekStart));
  },

};
