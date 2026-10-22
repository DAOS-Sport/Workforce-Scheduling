import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
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
  async getSalaryRates(tx: Executor = db): Promise<SalaryRateConfig[]> {
    return tx.select().from(salaryRateConfigs).orderBy(salaryRateConfigs.role);
  },

  async upsertSalaryRate(role: string, ratePerHour: number, label?: string, tx: Executor = db): Promise<SalaryRateConfig> {
    const existing = await tx.select().from(salaryRateConfigs).where(eq(salaryRateConfigs.role, role));
    if (existing.length > 0) {
      const [updated] = await tx.update(salaryRateConfigs)
        .set({ ratePerHour, label, updatedAt: new Date() })
        .where(eq(salaryRateConfigs.role, role))
        .returning();
      return updated;
    } else {
      const [created] = await tx.insert(salaryRateConfigs)
        .values({ role, ratePerHour, label })
        .returning();
      return created;
    }
  },

  async getSystemConfig(key: string, tx: Executor = db): Promise<SystemConfig | undefined> {
    const [config] = await tx.select().from(systemConfigs).where(eq(systemConfigs.key, key));
    return config;
  },

  async upsertSystemConfig(key: string, value: string, tx: Executor = db): Promise<SystemConfig> {
    const existing = await tx.select().from(systemConfigs).where(eq(systemConfigs.key, key));
    if (existing.length > 0) {
      const [updated] = await tx.update(systemConfigs)
        .set({ value, updatedAt: new Date() })
        .where(eq(systemConfigs.key, key))
        .returning();
      return updated;
    } else {
      const [created] = await tx.insert(systemConfigs)
        .values({ key, value })
        .returning();
      return created;
    }
  },

  async createMissingClockNotification(date: string, employeeId: number, shiftId: number, tx: Executor = db): Promise<void> {
    await tx.insert(missingClockNotifications)
      .values({ date, employeeId, shiftId })
      .onConflictDoNothing();
  },

  async clearOldMissingClockNotifications(beforeDate: string, tx: Executor = db): Promise<void> {
    await tx.delete(missingClockNotifications)
      .where(and(
        // delete all records with date < beforeDate
        lte(missingClockNotifications.date, beforeDate),
      ));
  },

  async getMissingClockNotificationsForDate(date: string, tx: Executor = db): Promise<MissingClockNotification[]> {
    return tx.select().from(missingClockNotifications)
      .where(eq(missingClockNotifications.date, date));
  },

  async hasWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string, tx: Executor = db): Promise<boolean> {
    const [row] = await tx.select({ id: weeklyPushNotifications.id })
      .from(weeklyPushNotifications)
      .where(and(
        eq(weeklyPushNotifications.weekStartDate, weekStartDate),
        eq(weeklyPushNotifications.employeeId, employeeId),
        eq(weeklyPushNotifications.pushType, pushType),
      ))
      .limit(1);
    return !!row;
  },

  async createWeeklyPushNotification(weekStartDate: string, employeeId: number, pushType: string, tx: Executor = db): Promise<void> {
    await tx.insert(weeklyPushNotifications)
      .values({ weekStartDate, employeeId, pushType })
      .onConflictDoNothing();
  },

  async clearOldWeeklyPushNotifications(beforeWeekStart: string, tx: Executor = db): Promise<void> {
    await tx.delete(weeklyPushNotifications)
      .where(lte(weeklyPushNotifications.weekStartDate, beforeWeekStart));
  },

};
