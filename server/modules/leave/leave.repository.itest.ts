import { beforeEach, describe, expect, it } from "vitest";
import { leaveBalanceLogs } from "@shared/schema";
import { db } from "../../infra/db";
import { withTx } from "../../infra/db/tx";
import { createEmployee, createRegion, resetDatabase } from "../../test/itest";
import { leaveRepository } from "./leave.repository";

const YEAR = 2026;
const hours = async (employeeId: number) => {
  const b = await leaveRepository.getLeaveBalance(employeeId, YEAR);
  return b && { total: b.totalHours, used: b.usedHours, pending: b.pendingHours };
};

beforeEach(async () => {
  await resetDatabase();
});

describe("leave balance SQL", () => {
  it("lists a year's balances with employee name and code, ordered by name, typed like the table rows", async () => {
    const region = await createRegion();
    const b = await createEmployee({ regionId: region.id, name: "乙員工", employeeCode: "L002" });
    const a = await createEmployee({ regionId: region.id, name: "甲員工", employeeCode: "L001" });
    await leaveRepository.upsertLeaveBalance(b.id, YEAR, 40);
    await leaveRepository.upsertLeaveBalance(a.id, YEAR, 56);
    await leaveRepository.upsertLeaveBalance(a.id, YEAR + 1, 80);

    const rows = await leaveRepository.getAllLeaveBalances(YEAR);

    const expected = await Promise.all(
      [b, a].map(async (e) => ({ ...(await leaveRepository.getLeaveBalance(e.id, YEAR)), employeeName: e.name, employeeCode: e.employeeCode })),
    );
    expect(rows).toEqual(expected.sort((x, y) => (x.employeeName < y.employeeName ? -1 : 1)));
    expect(rows.map((r) => [typeof r.totalHours, r.createdAt instanceof Date, r.updatedAt instanceof Date])).toEqual([
      ["number", true, true],
      ["number", true, true],
    ]);
  });

  it("moves pending, used and total hours like the balance ledger expects", async () => {
    const region = await createRegion();
    const e = await createEmployee({ regionId: region.id });

    expect(await leaveRepository.adjustLeaveBalancePending(e.id, YEAR, 8)).toBe(true);
    expect(await hours(e.id)).toEqual({ total: 0, used: 0, pending: 8 });

    expect(await leaveRepository.adjustLeaveBalancePending(e.id, YEAR, 4)).toBe(true);
    expect(await leaveRepository.adjustLeaveBalanceOnApprove(e.id, YEAR, 8)).toBe(true);
    expect(await hours(e.id)).toEqual({ total: 0, used: 8, pending: 4 });

    expect(await leaveRepository.adjustLeaveBalanceOnReject(e.id, YEAR, 4)).toBe(true);
    await leaveRepository.upsertLeaveBalance(e.id, YEAR, 56);
    expect(await hours(e.id)).toEqual({ total: 56, used: 8, pending: 0 });
  });

  it("refuses to settle more pending hours than are held, and changes nothing", async () => {
    const region = await createRegion();
    const e = await createEmployee({ regionId: region.id });
    await leaveRepository.adjustLeaveBalancePending(e.id, YEAR, 4);

    expect(await leaveRepository.adjustLeaveBalanceOnApprove(e.id, YEAR, 8)).toBe(false);
    expect(await leaveRepository.adjustLeaveBalanceOnReject(e.id, YEAR, 8)).toBe(false);

    expect(await hours(e.id)).toEqual({ total: 0, used: 0, pending: 4 });
  });

  it("refuses a negative pending change and creates no row for it", async () => {
    const region = await createRegion();
    const e = await createEmployee({ regionId: region.id });

    expect(await leaveRepository.adjustLeaveBalancePending(e.id, YEAR, -5)).toBe(false);
    expect(await hours(e.id)).toBeUndefined();

    await leaveRepository.adjustLeaveBalancePending(e.id, YEAR, 2);
    expect(await leaveRepository.adjustLeaveBalancePending(e.id, YEAR, -5)).toBe(false);
    expect(await hours(e.id)).toEqual({ total: 0, used: 0, pending: 2 });
  });

  it("sets the total on a row that exists and keeps the other hours, in one statement either way", async () => {
    const region = await createRegion();
    const e = await createEmployee({ regionId: region.id });

    const created = await leaveRepository.upsertLeaveBalance(e.id, YEAR, 40);
    await leaveRepository.adjustLeaveBalancePending(e.id, YEAR, 8);
    const updated = await leaveRepository.upsertLeaveBalance(e.id, YEAR, 56);

    expect([created.totalHours, updated.id, updated.totalHours, updated.pendingHours]).toEqual([40, created.id, 56, 8]);
  });

  it("writes on the transaction it is given, so a rollback undoes them", async () => {
    const region = await createRegion();
    const e = await createEmployee({ regionId: region.id });

    await expect(
      withTx(async (tx) => {
        await leaveRepository.adjustLeaveBalancePending(e.id, YEAR, 8, tx);
        await leaveRepository.appendLeaveBalanceLog(e.id, YEAR, 0, "申請特休 8h（待審）", undefined, undefined, undefined, tx);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect([await hours(e.id), await db.select().from(leaveBalanceLogs)]).toEqual([undefined, []]);
  });

  it("reports a missing balance as not settled on approve and reject, and does not create it", async () => {
    const region = await createRegion();
    const e = await createEmployee({ regionId: region.id });

    expect(await leaveRepository.adjustLeaveBalanceOnApprove(e.id, YEAR, 8)).toBe(false);
    expect(await leaveRepository.adjustLeaveBalanceOnReject(e.id, YEAR, 8)).toBe(false);

    expect(await hours(e.id)).toBeUndefined();
  });
});
