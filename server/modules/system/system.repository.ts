import { db } from "../../infra/db";
import { eq, and, lte } from "drizzle-orm";
import {
  salaryRateConfigs,
  systemConfigs,
  missingClockNotifications,
  weeklyPushNotifications,
  type SalaryRateConfig,
  type SystemConfig,
  type MissingClockNotification,
} from "@shared/schema";

export const systemRepository = {
  async getSalaryRates(): Promise<SalaryRateConfig[]> {
    return db.select().from(salaryRateConfigs).orderBy(salaryRateConfigs.role);
  },

  async upsertSalaryRate(role: string, ratePerHour: number, label?: string): Promise<SalaryRateConfig> {
    const existing = await db.select().from(salaryRateConfigs).where(eq(salaryRateConfigs.role, role));
    if (existing.length > 0) {
      const [updated] = await db.update(salaryRateConfigs)
        .set({ ratePerHour, label, updatedAt: new Date() })
        .where(eq(salaryRateConfigs.role, role))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(salaryRateConfigs)
        .values({ role, ratePerHour, label })
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

  async createMissingClockNotification(date: string, employeeId: number, shiftId: number): Promise<void> {
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
    await db.insert(weeklyPushNotifications)
      .values({ weekStartDate, employeeId, pushType })
      .onConflictDoNothing();
  },

  async clearOldWeeklyPushNotifications(beforeWeekStart: string): Promise<void> {
    await db.delete(weeklyPushNotifications)
      .where(lte(weeklyPushNotifications.weekStartDate, beforeWeekStart));
  },

};
