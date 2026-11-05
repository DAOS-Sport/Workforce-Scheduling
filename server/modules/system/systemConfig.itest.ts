import { beforeEach, describe, expect, it } from "vitest";
import { salaryRateConfigs, systemConfigs } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, resetDatabase, warmPool } from "../../test/itest";
import { systemService } from "./system.service";

beforeEach(async () => {
  await resetDatabase();
  await warmPool(4);
});

describe("salary rate upsert", () => {
  it("lets two simultaneous requests for a new role both succeed and leaves one row", async () => {
    const results = await concurrently(2, (i) => systemService.upsertSalaryRate("虛構職務", 200 + i, "虛構"));

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await db.select().from(salaryRateConfigs)).toHaveLength(1);
  });

  it("updates the rate of an existing role and keeps its label when none is given", async () => {
    await systemService.upsertSalaryRate("虛構職務", 200, "原標籤");

    await systemService.upsertSalaryRate("虛構職務", 250);

    const [row] = await db.select().from(salaryRateConfigs);
    expect([row.ratePerHour, row.label]).toEqual([250, "原標籤"]);
  });
});

describe("system config upsert", () => {
  it("lets two simultaneous first writes of a key both succeed and leaves one row", async () => {
    const results = await concurrently(2, (i) => systemService.upsertSystemConfig("date_annotations", `[${i}]`));

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await db.select().from(systemConfigs)).toHaveLength(1);
  });

  it("refuses a key the pages do not own, so the API cannot touch health records or boot markers", async () => {
    for (const key of ["health:job:ragic.sync", "migration:initial-admin-v1", "anything_else"]) {
      await expect(systemService.upsertSystemConfig(key, "x")).rejects.toMatchObject({ status: 400 });
    }
    expect(await db.select().from(systemConfigs)).toHaveLength(0);
  });

  it("accepts every key the pages write", async () => {
    for (const key of ["availability_window", "monthly_holidays", "date_annotations", "four_week_reference_date", "summer-payroll-config-v1"]) {
      await systemService.upsertSystemConfig(key, "{}");
    }
    expect(await db.select().from(systemConfigs)).toHaveLength(5);
  });

  describe("when the writer says which version it read", () => {
    it("writes when the stored version is the one it read, and refuses with 409 when someone saved in between", async () => {
      const first = await systemService.upsertSystemConfig("monthly_holidays", '{"2026-11":[]}');
      const readByA = first.updatedAt!.toISOString();

      await systemService.upsertSystemConfig("monthly_holidays", '{"2026-11":["2026-11-10"]}', readByA);
      await expect(systemService.upsertSystemConfig("monthly_holidays", '{"2026-11":["2026-11-11"]}', readByA)).rejects.toMatchObject({ status: 409 });

      expect((await systemService.getSystemConfig("monthly_holidays")).value).toBe('{"2026-11":["2026-11-10"]}');
    });

    it("matches the version at the precision a browser sends back (milliseconds)", async () => {
      await db.insert(systemConfigs).values({ key: "date_annotations", value: "[]" });
      const read = (await systemService.getSystemConfig("date_annotations")).updatedAt!.toISOString();

      await expect(systemService.upsertSystemConfig("date_annotations", "[1]", read)).resolves.toMatchObject({ value: "[1]" });
    });

    it("still writes without a version, as older pages do", async () => {
      await systemService.upsertSystemConfig("monthly_holidays", "a");
      await expect(systemService.upsertSystemConfig("monthly_holidays", "b")).resolves.toMatchObject({ value: "b" });
    });
  });
});
