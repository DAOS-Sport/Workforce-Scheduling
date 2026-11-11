import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { employees } from "@shared/schema";
import { db } from "../../infra/db";
import { createEmployee, createRegion, resetDatabase } from "../../test/itest";
import { readJobState } from "../../shared/health/healthState";
import { evaluateSyncJob } from "../../core/health/rules";
import { runRagicSync } from "./ragic.service";

const ragic = vi.hoisted(() => ({ h01: vi.fn(), h02: vi.fn() }));
vi.mock("../../adapters/ragic", () => ({ fetchAllRagicRecords: ragic.h01, fetchH02RagicRecords: ragic.h02 }));

const CODE = "H02-FIX-001";
const h01 = (role: unknown = ["教練"]) => ({
  "1": { 員工編號: CODE, 姓名: "虛構同步甲", 部門: "新北高中", 聘雇類別: "兼職", 在職狀態: "在職", 應徵職務: role },
});
const h02 = (role: unknown) => ({ "81": { 員工編號: CODE, 應徵職務: role } });
const employee = async () => (await db.select().from(employees).where(eq(employees.employeeCode, CODE)))[0];
const pipeline = async () => evaluateSyncJob({ id: "ragic.employee-sync", name: "Ragic 員工同步", now: new Date(), state: await readJobState("ragic.sync") });

beforeEach(async () => {
  await resetDatabase();
  process.env.RAGIC_API_KEY = "h02-fixture-key";
  ragic.h01.mockReset().mockResolvedValue(h01());
  ragic.h02.mockReset().mockResolvedValue({});
  const region = await createRegion({ code: "A", name: "虛構區域" });
  await createEmployee({ regionId: region.id, employeeCode: CODE, name: "虛構同步甲", role: "行政專員", status: "active" });
});

describe("H02 role sync through the real transaction and health state", () => {
  it("keeps the H01 back-office role ahead of H02", async () => {
    ragic.h01.mockResolvedValue(h01(["主管職"]));
    ragic.h02.mockResolvedValue(h02(["資訊工程師"]));
    await runRagicSync("manual");
    expect((await employee()).role).toBe("主管職");
  });

  it("updates an H02-only local employee by code without creating an H02-only employee", async () => {
    ragic.h01.mockResolvedValue({ "2": { ...h01()["1"], 員工編號: "H01-FIX-ANCHOR", 在職狀態: "離職" } });
    ragic.h02.mockResolvedValue({ ...h02(["主管職"]), "82": { 員工編號: "H02-FIX-NEW", 姓名: "虛構新員工", 應徵職務: ["教練"] } });
    await runRagicSync("manual");
    const row = await employee();
    expect([row.role, row.status, row.name]).toEqual(["主管職", "active", "虛構同步甲"]);
    expect(await db.select().from(employees)).toHaveLength(1);
  });

  it("fills a blank H01 title from the H02 multiselect using H01 mapping order", async () => {
    ragic.h01.mockResolvedValue(h01(["", "　"]));
    ragic.h02.mockResolvedValue(h02(["主管職", "資訊工程師", "行政專員"]));
    await db.update(employees).set({ role: "無職" }).where(eq(employees.employeeCode, CODE));
    await runRagicSync("manual");
    expect((await employee()).role).toBe("行政專員");
  });

  it("commits H01 and reports yellow with one error when H02 cannot be read", async () => {
    ragic.h02.mockRejectedValue(new Error("fixture H02 unavailable"));
    const outcome = await runRagicSync("manual");
    expect(outcome.busy).toBe(false);
    if (outcome.busy) throw new Error("unexpected busy");
    expect((await employee()).role).toBe("教練");
    expect(outcome.result.errors).toEqual(["H02 讀取失敗；本輪僅同步 H01"]);
    const state = await readJobState("ragic.sync");
    expect([state?.lastStatus, state?.lastSummary?.errors]).toEqual(["success", 1]);
    expect((await pipeline()).level).toBe("yellow");
  });

  it("reports green after both sources succeed, including recovery from an H02 failure", async () => {
    ragic.h02.mockRejectedValueOnce(new Error("fixture unavailable"));
    await runRagicSync("manual");
    expect((await pipeline()).level).toBe("yellow");
    await runRagicSync("manual");
    expect((await pipeline()).level).toBe("green");
    expect((await readJobState("ragic.sync"))?.lastSummary?.errors).toBe(0);
  });

  it("reports red and writes no employee changes when H01 fails before any success", async () => {
    ragic.h01.mockRejectedValue(new Error("fixture H01 unavailable"));
    await expect(runRagicSync("manual")).rejects.toThrow("fixture H01 unavailable");
    expect((await employee()).role).toBe("行政專員");
    expect((await pipeline()).level).toBe("red");
  });
});
