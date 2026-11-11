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
  it("includes only pending rows in the last seven days and strictly over ten minutes old", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into push_dedup (scope, period, employee_id, ref_id, status, updated_at) values
          ('health-test', 'test', 90001, 'oldest-included', 'pending', (now() at time zone 'UTC') - interval '7 days'),
          ('health-test', 'test', 90002, 'over-ten', 'pending', (now() at time zone 'UTC') - interval '10 minutes 1 millisecond'),
          ('health-test', 'test', 90003, 'exact-ten', 'pending', (now() at time zone 'UTC') - interval '10 minutes'),
          ('health-test', 'test', 90004, 'recent', 'pending', (now() at time zone 'UTC') - interval '9 minutes'),
          ('health-test', 'test', 90005, 'too-old', 'pending', (now() at time zone 'UTC') - interval '7 days 1 millisecond'),
          ('health-test', 'test', 90006, 'sent', 'sent', (now() at time zone 'UTC') - interval '1 hour'),
          ('health-test', 'test', 90007, 'failed', 'failed', (now() at time zone 'UTC') - interval '1 hour')
      `);
      const expected = await tx.execute(sql`select extract(epoch from (now() - interval '7 days')) * 1000 as oldest_ms`);
      // 同一 transaction 的 now() 固定，讓等於 7 天／10 分鐘的精確邊界不受兩次查詢間耗時影響。
      vi.spyOn(db, "execute").mockImplementation((query) => tx.execute(query) as any);

      const signals = await collectSignals(new Date());
      expect(signals.pushDelivery).toEqual({
        pendingCount: 2,
        oldestPendingAt: new Date(Number(expected.rows[0].oldest_ms)).toISOString(),
      });
      const pipeline = assembleReport(signals).pipelines.find((p) => p.id === "push.delivery");
      expect(pipeline).toMatchObject({ level: "yellow" });
      expect(pipeline?.reason).toContain("2 筆");
      expect(pipeline?.reason).not.toMatch(/9000[1-7]/);
    });
  });

  it("is green when only recent or finished rows remain", async () => {
    await db.execute(sql`
      insert into push_dedup (scope, period, employee_id, status, updated_at) values
        ('health-test', 'test', 90001, 'pending', (now() at time zone 'UTC') - interval '9 minutes'),
        ('health-test', 'test', 90002, 'sent', (now() at time zone 'UTC') - interval '1 hour'),
        ('health-test', 'test', 90003, 'failed', (now() at time zone 'UTC') - interval '1 hour')
    `);

    const signals = await collectSignals(new Date());
    expect(signals.pushDelivery).toEqual({ pendingCount: 0, oldestPendingAt: null });
    expect(assembleReport(signals).pipelines.find((p) => p.id === "push.delivery")?.level).toBe("green");
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
        oldestPendingAt: new Date(Number(expected.rows[0].oldest_ms)).toISOString(),
      });
    });
  });
});
