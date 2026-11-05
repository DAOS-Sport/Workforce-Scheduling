import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { eq, and, lte, sql } from "drizzle-orm";
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

  /** One statement on the role's unique key, so two simultaneous first writes of a role both land. */
  async upsertSalaryRate(role: string, ratePerHour: number, label?: string, tx: Executor = db): Promise<SalaryRateConfig> {
    const [row] = await tx
      .insert(salaryRateConfigs)
      .values({ role, ratePerHour, label })
      .onConflictDoUpdate({
        target: salaryRateConfigs.role,
        set: { ratePerHour, ...(label !== undefined ? { label } : {}), updatedAt: new Date() },
      })
      .returning();
    return row;
  },

  async getSystemConfig(key: string, tx: Executor = db): Promise<SystemConfig | undefined> {
    const [config] = await tx.select().from(systemConfigs).where(eq(systemConfigs.key, key));
    return config;
  },

  /**
   * One statement on the key's unique key. With `expectedUpdatedAt` the write happens only if the stored version is
   * that one (to the millisecond a browser can send back); undefined means someone saved in between.
   */
  async upsertSystemConfig(key: string, value: string, expectedUpdatedAt?: Date, tx: Executor = db): Promise<SystemConfig | undefined> {
    const now = new Date();
    const [row] = await tx
      .insert(systemConfigs)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: systemConfigs.key,
        set: { value, updatedAt: now },
        setWhere:
          expectedUpdatedAt === undefined
            ? undefined
            : sql`date_trunc('milliseconds', ${systemConfigs.updatedAt}) = ${expectedUpdatedAt.toISOString()}::timestamp`,
      })
      .returning();
    return row;
  },

  /**
   * Merges `patch` into the JSON object stored under `key` in one statement, so writers on different instances
   * each keep their own fields. `increment` names a numeric field to raise by one in that same statement.
   * `stampRecovery` marks the patch as a success: when the stored row's last failure is newer than its last success,
   * the same statement also writes `recoveredAt` (the patch's `lastSuccessAt`), so the first success after an outage
   * is recorded exactly once and later successes leave it alone.
   */
  async mergeJsonConfig(key: string, patch: Record<string, unknown>, options: { increment?: string; stampRecovery?: boolean } = {}, tx: Executor = db): Promise<void> {
    const { increment, stampRecovery } = options;
    const inserted = JSON.stringify(increment ? { ...patch, [increment]: 1 } : patch);
    const bump = increment
      ? sql`jsonb_build_object(${increment}::text, coalesce((system_configs.value::jsonb ->> ${increment}::text)::int, 0) + 1)`
      : sql`'{}'::jsonb`;
    const stamp = stampRecovery
      ? sql`case when coalesce(system_configs.value::jsonb ->> 'lastFailureAt', '') > coalesce(system_configs.value::jsonb ->> 'lastSuccessAt', '')
          then jsonb_build_object('recoveredAt', excluded.value::jsonb ->> 'lastSuccessAt') else '{}'::jsonb end`
      : sql`'{}'::jsonb`;
    await tx.execute(sql`
      insert into system_configs (key, value, updated_at) values (${key}, ${inserted}, now())
      on conflict (key) do update
        set value = (system_configs.value::jsonb || excluded.value::jsonb || ${bump} || ${stamp})::text, updated_at = now()`);
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

  async clearOldWeeklyPushNotifications(beforeWeekStart: string, tx: Executor = db): Promise<void> {
    await tx.delete(weeklyPushNotifications)
      .where(lte(weeklyPushNotifications.weekStartDate, beforeWeekStart));
  },

};
