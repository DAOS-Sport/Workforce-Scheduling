import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { dispatchShifts, employees } from "@shared/schema";
import { db } from "../../infra/db";
import { createEmployee, createRegion, resetDatabase } from "../../test/itest";
import { withFailingWrites } from "../../test/failWrites";
import { employeeService } from "../employee/employee.service";
import { dispatchService } from "./dispatch.service";

const region = () => createRegion();

const addDispatch = (regionId: number, dispatchName: string, date = "2026-11-03") =>
  db.insert(dispatchShifts).values({ regionId, date, startTime: "08:00", endTime: "12:00", dispatchName }).returning().then((rows) => rows[0]);
const linkOf = async (id: number) => (await db.select().from(dispatchShifts).where(eq(dispatchShifts.id, id)))[0].linkedEmployeeId;

beforeEach(async () => {
  await resetDatabase();
});

describe("batch create dispatch shifts", () => {
  const body = (regionCode: string, dates: string[]) => ({ regionCode, dates, startTime: "08:00", endTime: "12:00", dispatchName: "虛構派遣甲" });

  it("creates one row per date", async () => {
    const r = await region();

    const result: any = await dispatchService.batchCreate(body(r.code, ["2026-11-03", "2026-11-04"]));

    expect(result.created).toBe(2);
    expect((await db.select().from(dispatchShifts)).map((d) => d.date)).toEqual(["2026-11-03", "2026-11-04"]);
  });

  it("a failure on the third date leaves none of the dates written", async () => {
    const r = await region();

    await withFailingWrites("dispatch_shifts", "insert", `NEW.date = '2026-11-05'`, async () => {
      await expect(dispatchService.batchCreate(body(r.code, ["2026-11-03", "2026-11-04", "2026-11-05"]))).rejects.toThrow();
    });

    expect(await db.select().from(dispatchShifts)).toHaveLength(0);
  });
});

describe("linking dispatch shifts to employees by name", () => {
  it("a name shared by two active employees is not linked to either", async () => {
    const r = await region();
    await createEmployee({ regionId: r.id, name: "同名虛構員工" });
    await createEmployee({ regionId: r.id, name: "同名虛構員工" });
    const shift = await addDispatch(r.id, "同名虛構員工");

    const result: any = await dispatchService.reconcileLinks();

    expect(result.updated).toBe(0);
    expect(await linkOf(shift.id)).toBeNull();
  });

  it("a name with exactly one active employee is linked, and linking again changes nothing", async () => {
    const r = await region();
    const only = await createEmployee({ regionId: r.id, name: "唯一虛構員工" });
    await createEmployee({ regionId: r.id, name: "唯一虛構員工", status: "inactive" });
    const shift = await addDispatch(r.id, " 唯一虛構員工 ");

    const first: any = await dispatchService.reconcileLinks();
    const second: any = await dispatchService.reconcileLinks();

    expect([first.updated, second.updated]).toEqual([1, 0]);
    expect(await linkOf(shift.id)).toBe(only.id);
  });

  it("an already linked shift is not relinked", async () => {
    const r = await region();
    await createEmployee({ regionId: r.id, name: "甲虛構員工" });
    const b = await createEmployee({ regionId: r.id, name: "乙虛構員工" });
    const shift = await addDispatch(r.id, "甲虛構員工");
    await db.update(dispatchShifts).set({ linkedEmployeeId: b.id }).where(eq(dispatchShifts.id, shift.id));

    await dispatchService.reconcileLinks();

    expect(await linkOf(shift.id)).toBe(b.id);
  });

  it("creating an employee links the matching dispatch shift before the call returns", async () => {
    const r = await region();
    const shift = await addDispatch(r.id, "新進虛構員工");

    const created = await employeeService.create({ name: "新進虛構員工", employeeCode: "B5NEW01", regionId: r.id });

    expect(await linkOf(shift.id)).toBe(created.id);
  });

  it("when linking fails the employee is not created either, instead of the failure being swallowed", async () => {
    const r = await region();
    await addDispatch(r.id, "新進虛構員工");

    await withFailingWrites("dispatch_shifts", "update", "true", async () => {
      await expect(employeeService.create({ name: "新進虛構員工", employeeCode: "B5NEW02", regionId: r.id })).rejects.toThrow();
    });

    expect(await db.select().from(employees).where(eq(employees.employeeCode, "B5NEW02"))).toHaveLength(0);
  });
});
