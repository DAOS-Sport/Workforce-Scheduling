import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { employees, shifts } from "@shared/schema";
import { db } from "../../infra/db";
import { createEmployee, createRegion, createShift, createVenue, resetDatabase } from "../../test/itest";
import { lineUserId } from "../../test/clock";
import { employeeService } from "./employee.service";

beforeEach(resetDatabase);

describe("removing an employee from the back office", () => {
  it("keeps the row and everything that points at it, and marks the employee inactive", async () => {
    const region = await createRegion();
    const venue = await createVenue({ regionId: region.id });
    const emp = await createEmployee({ regionId: region.id });
    const shift = await createShift({ employeeId: emp.id, venueId: venue.id, date: "2026-11-02", startTime: "09:00", endTime: "12:00" });

    expect(await employeeService.remove(emp.id)).toBe(true);

    const [row] = await db.select().from(employees).where(eq(employees.id, emp.id));
    expect(row?.status).toBe("inactive");
    expect((await db.select().from(shifts).where(eq(shifts.id, shift.id)))[0].employeeId).toBe(emp.id);
  });

  it("answers the same way when the employee is removed twice, and false for one that does not exist", async () => {
    const region = await createRegion();
    const emp = await createEmployee({ regionId: region.id });

    expect(await employeeService.remove(emp.id)).toBe(true);
    expect(await employeeService.remove(emp.id)).toBe(true);
    expect(await employeeService.remove(emp.id + 999)).toBe(false);
  });
});

describe("a removed employee's LINE account", () => {
  // Removing does not unbind; binding again writes the account onto the new record and leaves the old one as it was.
  it("can be bound to a new active record, and the removed record keeps the account", async () => {
    const region = await createRegion();
    const account = lineUserId(0xc);
    const removed = await createEmployee({ regionId: region.id, lineId: account });
    const other = await createEmployee({ regionId: region.id });
    await employeeService.remove(removed.id);

    const result = await employeeService.bindLineAccount(account, other.employeeCode);

    expect(result).toMatchObject({ kind: "bound", employee: { id: other.id, lineId: account } });
    const lineIdOf = async (id: number) => (await db.select().from(employees).where(eq(employees.id, id)))[0].lineId;
    expect(await lineIdOf(removed.id)).toBe(account);
    expect((await employeeService.getEmployeeByLineId(account))?.id).toBe(other.id);
  });

  it("is refused another code while the record that holds it is still active", async () => {
    const region = await createRegion();
    const account = lineUserId(0xc);
    const holder = await createEmployee({ regionId: region.id, lineId: account });
    const other = await createEmployee({ regionId: region.id });

    const result = await employeeService.bindLineAccount(account, other.employeeCode);

    expect(result).toMatchObject({ kind: "already_bound", employee: { id: holder.id, status: "active" } });
    expect((await db.select().from(employees).where(eq(employees.id, other.id)))[0].lineId).toBeNull();
  });

  it("is still refused a code that another LINE account holds", async () => {
    const region = await createRegion();
    const account = lineUserId(0xc);
    const removed = await createEmployee({ regionId: region.id, lineId: account });
    const taken = await createEmployee({ regionId: region.id, lineId: lineUserId(0xd) });
    await employeeService.remove(removed.id);

    const result = await employeeService.bindLineAccount(account, taken.employeeCode);

    expect(result).toMatchObject({ kind: "taken", employee: { id: taken.id } });
  });
});
