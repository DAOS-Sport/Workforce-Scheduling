import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../infra/db";
import { resetDatabase } from "../../test/itest";

vi.mock("../../config/env", () => ({ IS_PRODUCTION: false }));

import { collectSignals } from "./health.service";
import { assembleReport } from "../../core/health/report";

beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("MCP_TOKEN", "health-itest-mcp");
  vi.stubEnv("INTERNAL_API_TOKEN", "health-itest-internal");
  vi.stubEnv("SESSION_SECRET", "health-itest-session");
  vi.stubEnv("LINE_CHANNEL_SECRET", "health-itest-line");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("push delivery health database aggregate", () => {
  it("is red for recent overdue pending rows and preserves the full seven-day aggregate", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into push_dedup (scope, period, employee_id, ref_id, status, updated_at) values
          ('health-test', 'test', 90001, 'oldest-included', 'pending', (now() at time zone 'UTC') - interval '7 days'),
          ('health-test', 'test', 90002, 'over-ten', 'pending', (now() at time zone 'UTC') - interval '10 minutes 1 millisecond'),
          ('health-test', 'test', 90003, 'exact-day', 'pending', (now() at time zone 'UTC') - interval '24 hours'),
          ('health-test', 'test', 90004, 'over-day', 'pending', (now() at time zone 'UTC') - interval '24 hours 1 millisecond'),
          ('health-test', 'test', 90005, 'exact-ten', 'pending', (now() at time zone 'UTC') - interval '10 minutes'),
          ('health-test', 'test', 90006, 'recent', 'pending', (now() at time zone 'UTC') - interval '9 minutes'),
          ('health-test', 'test', 90007, 'too-old', 'pending', (now() at time zone 'UTC') - interval '7 days 1 millisecond'),
          ('health-test', 'test', 90008, 'sent', 'sent', (now() at time zone 'UTC') - interval '1 hour'),
          ('health-test', 'test', 90009, 'failed', 'failed', (now() at time zone 'UTC') - interval '1 hour')
      `);
      const expected = await tx.execute(sql`select extract(epoch from (now() - interval '7 days')) * 1000 as oldest_ms`);
      // 同一 transaction 的 now() 固定，讓 7 天／24 小時／10 分鐘的精確邊界不受查詢間耗時影響。
      vi.spyOn(db, "execute").mockImplementation((query) => tx.execute(query) as any);

      const signals = await collectSignals(new Date());
      expect(signals.pushDelivery).toEqual({
        pendingCount: 4,
        recentPendingCount: 2,
        oldestPendingAt: new Date(Number(expected.rows[0].oldest_ms)).toISOString(),
      });
      const pipeline = assembleReport(signals).pipelines.find((p) => p.id === "push.delivery");
      expect(pipeline).toMatchObject({ level: "red" });
      expect(pipeline?.reason).toContain("24 小時");
      expect(pipeline?.reason).toContain("2 筆");
      expect(pipeline?.reason).toContain("4 筆");
      expect(pipeline?.reason).not.toMatch(/9000[1-9]/);
    });
  });

  it("is yellow when overdue pending rows are all older than twenty-four hours but within seven days", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into push_dedup (scope, period, employee_id, ref_id, status, updated_at) values
          ('health-test', 'test', 90001, 'oldest-included', 'pending', (now() at time zone 'UTC') - interval '7 days'),
          ('health-test', 'test', 90002, 'over-day', 'pending', (now() at time zone 'UTC') - interval '24 hours 1 millisecond'),
          ('health-test', 'test', 90003, 'too-old', 'pending', (now() at time zone 'UTC') - interval '7 days 1 millisecond')
      `);
      const expected = await tx.execute(sql`select extract(epoch from (now() - interval '7 days')) * 1000 as oldest_ms`);
      vi.spyOn(db, "execute").mockImplementation((query) => tx.execute(query) as any);

      const signals = await collectSignals(new Date());
      expect(signals.pushDelivery).toEqual({
        pendingCount: 2,
        recentPendingCount: 0,
        oldestPendingAt: new Date(Number(expected.rows[0].oldest_ms)).toISOString(),
      });
      const pipeline = assembleReport(signals).pipelines.find((p) => p.id === "push.delivery");
      expect(pipeline).toMatchObject({ level: "yellow" });
      expect(pipeline?.reason).toContain("2 筆");
      expect(pipeline?.reason).not.toMatch(/9000[1-3]/);
    });
  });

  it("is green at exactly ten minutes and when only newer, expired, or finished rows remain", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into push_dedup (scope, period, employee_id, ref_id, status, updated_at) values
          ('health-test', 'test', 90001, 'exact-ten', 'pending', (now() at time zone 'UTC') - interval '10 minutes'),
          ('health-test', 'test', 90002, 'recent', 'pending', (now() at time zone 'UTC') - interval '9 minutes'),
          ('health-test', 'test', 90003, 'too-old', 'pending', (now() at time zone 'UTC') - interval '7 days 1 millisecond'),
          ('health-test', 'test', 90004, 'sent', 'sent', (now() at time zone 'UTC') - interval '1 hour'),
          ('health-test', 'test', 90005, 'failed', 'failed', (now() at time zone 'UTC') - interval '1 hour')
      `);
      vi.spyOn(db, "execute").mockImplementation((query) => tx.execute(query) as any);

      const signals = await collectSignals(new Date());
      expect(signals.pushDelivery).toEqual({ pendingCount: 0, recentPendingCount: 0, oldestPendingAt: null });
      const pipeline = assembleReport(signals).pipelines.find((p) => p.id === "push.delivery");
      expect(pipeline?.level).toBe("green");
      expect(pipeline?.reason).not.toMatch(/9000[1-5]/);
    });
  });

  it("uses the database UTC clock and preserves the instant with Taipei Node and session timezones", async () => {
    vi.stubEnv("TZ", "Asia/Taipei");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local time zone 'Asia/Taipei'`);
      await tx.execute(sql`
        insert into push_dedup (scope, period, employee_id, status, updated_at)
        values ('health-test', 'test', 90001, 'pending', (now() at time zone 'UTC') - interval '11 minutes')
      `);
      const expected = await tx.execute(sql`select extract(epoch from (now() - interval '11 minutes')) * 1000 as oldest_ms`);
      vi.spyOn(db, "execute").mockImplementation((query) => tx.execute(query) as any);

      const signals = await collectSignals(new Date());
      expect(signals.pushDelivery).toEqual({
        pendingCount: 1,
        recentPendingCount: 1,
        oldestPendingAt: new Date(Number(expected.rows[0].oldest_ms)).toISOString(),
      });
      expect(assembleReport(signals).pipelines.find((p) => p.id === "push.delivery")?.level).toBe("red");
    });
  });
});
