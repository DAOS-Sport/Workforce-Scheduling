import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { employeeLeaveBalances, leaveBalanceLogs, leaveRequests } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, resetDatabase, warmPool } from "../../test/itest";
import { leaveRepository } from "./leave.repository";
import { leaveService } from "./leave.service";
import { LOCK_NS } from "../../infra/db/tx";
import { runWhileLockHeld } from "../../test/lock";

const YEAR = 2026;
const DAY = "2026-10-05";

async function employeeWithBalance(totalHours: number | null = 8) {
  const region = await createRegion();
  const employee = await createEmployee({ regionId: region.id });
  if (totalHours !== null) await leaveRepository.upsertLeaveBalance(employee.id, YEAR, totalHours);
  return employee;
}

const submitAnnual = (employeeId: number, extra: Record<string, unknown> = {}) =>
  leaveService.submit({ employeeId, leaveType: "特休", startDate: DAY, endDate: DAY, ...extra });
const review = (id: number, status: string, adminId = 1) => leaveService.review(id, status, undefined, adminId, `管理員${adminId}`);

const balanceOf = async (employeeId: number) => {
  const row = await leaveRepository.getLeaveBalance(employeeId, YEAR);
  return row && { total: row.totalHours, used: row.usedHours, pending: row.pendingHours };
};
const requestsOf = (employeeId: number) => db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)).orderBy(leaveRequests.id);
const requestRow = async (id: number) => (await db.select().from(leaveRequests).where(eq(leaveRequests.id, id)))[0];
const logsOf = (employeeId: number) => db.select().from(leaveBalanceLogs).where(eq(leaveBalanceLogs.employeeId, employeeId)).orderBy(leaveBalanceLogs.id);
const errorStatuses = (results: PromiseSettledResult<unknown>[]) =>
  results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.status);

function delayAfter<K extends "getLeaveBalance" | "getLeaveRequest">(method: K, ms = 80) {
  const read = leaveRepository[method] as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(leaveRepository, method).mockImplementation((async (...args: unknown[]) => {
    const row = await read(...args);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return row;
  }) as never);
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitting a leave request", () => {
  it("an annual leave reserves its hours as pending and leaves a log line", async () => {
    const e = await employeeWithBalance(16);

    const request = await submitAnnual(e.id);

    expect([request.status, request.hours]).toEqual(["pending", 8]);
    expect(await balanceOf(e.id)).toEqual({ total: 16, used: 0, pending: 8 });
    expect((await logsOf(e.id)).map((l) => [l.delta, l.leaveRequestId])).toEqual([[0, request.id]]);
  });

  it("another kind of leave does not touch the balance", async () => {
    const e = await employeeWithBalance(16);

    await leaveService.submit({ employeeId: e.id, leaveType: "事假", startDate: DAY, endDate: DAY });

    expect(await balanceOf(e.id)).toEqual({ total: 16, used: 0, pending: 0 });
    expect(await logsOf(e.id)).toEqual([]);
  });

  it("asking for more than is left is refused and writes nothing", async () => {
    const e = await employeeWithBalance(4);

    await expect(submitAnnual(e.id)).rejects.toMatchObject({ status: 400 });

    expect([await requestsOf(e.id), await balanceOf(e.id), await logsOf(e.id)]).toEqual([[], { total: 4, used: 0, pending: 0 }, []]);
  });

  it("two annual leaves of 8 hours at once with 8 hours left: one is accepted, the other refused, and 8 hours are pending", async () => {
    const e = await employeeWithBalance(8);
    delayAfter("getLeaveBalance");
    await warmPool(4);

    const results = await concurrently(2, () => submitAnnual(e.id));

    expect(errorStatuses(results)).toEqual([400]);
    expect(await requestsOf(e.id)).toHaveLength(1);
    expect(await balanceOf(e.id)).toEqual({ total: 8, used: 0, pending: 8 });
    expect(await logsOf(e.id)).toHaveLength(1);
  });

  it("when writing the log fails, the request and the pending hours are not kept", async () => {
    const e = await employeeWithBalance(8);
    vi.spyOn(leaveRepository, "appendLeaveBalanceLog").mockRejectedValue(new Error("disk full"));

    await expect(submitAnnual(e.id)).rejects.toThrow("disk full");

    expect([await requestsOf(e.id), await balanceOf(e.id)]).toEqual([[], { total: 8, used: 0, pending: 0 }]);
  });

  it("when reserving the hours fails, no request is kept", async () => {
    const e = await employeeWithBalance(8);
    vi.spyOn(leaveRepository, "adjustLeaveBalancePending").mockRejectedValue(new Error("disk full"));

    await expect(submitAnnual(e.id)).rejects.toThrow("disk full");

    expect([await requestsOf(e.id), await logsOf(e.id)]).toEqual([[], []]);
  });
});

describe("reviewing an annual leave", () => {
  it("approval turns the pending hours into used hours and logs the deduction", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);

    const reviewed = await review(request.id, "approved");

    expect([reviewed.status, reviewed.reviewedBy]).toEqual(["approved", 1]);
    expect(await balanceOf(e.id)).toEqual({ total: 16, used: 8, pending: 0 });
    expect((await logsOf(e.id)).map((l) => l.delta)).toEqual([0, -8]);
  });

  it("rejection gives the pending hours back", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);

    await review(request.id, "rejected");

    expect(await balanceOf(e.id)).toEqual({ total: 16, used: 0, pending: 0 });
    expect((await requestRow(request.id)).status).toBe("rejected");
  });

  it("reviewing another kind of leave leaves the balance alone", async () => {
    const e = await employeeWithBalance(16);
    const request = await leaveService.submit({ employeeId: e.id, leaveType: "事假", startDate: DAY, endDate: DAY });

    await review(request.id, "approved");

    expect([await balanceOf(e.id), await logsOf(e.id)]).toEqual([{ total: 16, used: 0, pending: 0 }, []]);
  });

  it("two approvals at once: one wins, the other gets 409, and the hours are deducted once, not out of a second pending request", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);
    await submitAnnual(e.id);
    delayAfter("getLeaveRequest");
    await warmPool(4);

    const results = await concurrently(2, (i) => review(request.id, "approved", i + 1));

    expect(errorStatuses(results)).toEqual([409]);
    expect(await balanceOf(e.id)).toEqual({ total: 16, used: 8, pending: 8 });
    expect((await logsOf(e.id)).map((l) => l.delta)).toEqual([0, 0, -8]);
  });

  it("an approval and a rejection at once: one wins, the other gets 409, and the balance matches the status", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);
    await submitAnnual(e.id);
    delayAfter("getLeaveRequest");
    await warmPool(4);

    const statuses = ["approved", "rejected"];
    const results = await concurrently(2, (i) => review(request.id, statuses[i], i + 1));

    expect(errorStatuses(results)).toEqual([409]);
    const winner = statuses[results.findIndex((r) => r.status === "fulfilled")];
    expect((await requestRow(request.id)).status).toBe(winner);
    expect(await balanceOf(e.id)).toEqual({ total: 16, used: winner === "approved" ? 8 : 0, pending: 8 });
  });

  it("a request that was already reviewed gets 409 and nothing changes, even while another request holds pending hours", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);
    await submitAnnual(e.id);
    await review(request.id, "approved");
    const before = [await requestRow(request.id), await balanceOf(e.id), await logsOf(e.id)];

    await expect(review(request.id, "rejected", 2)).rejects.toMatchObject({ status: 409 });
    await expect(review(request.id, "approved", 2)).rejects.toMatchObject({ status: 409 });

    expect([await requestRow(request.id), await balanceOf(e.id), await logsOf(e.id)]).toEqual(before);
  });

  it("an unknown request is 404", async () => {
    await expect(review(999999, "approved")).rejects.toMatchObject({ status: 404 });
  });

  it("when the balance update fails, the request is still pending and the balance and log are as before", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);
    const before = [await requestRow(request.id), await balanceOf(e.id), await logsOf(e.id)];
    vi.spyOn(leaveRepository, "adjustLeaveBalanceOnApprove").mockRejectedValue(new Error("disk full"));

    await expect(review(request.id, "approved")).rejects.toThrow("disk full");

    expect([await requestRow(request.id), await balanceOf(e.id), await logsOf(e.id)]).toEqual(before);
  });

  it("when writing the log fails, the request is still pending and the balance is as before", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);
    const before = [await requestRow(request.id), await balanceOf(e.id), await logsOf(e.id)];
    vi.spyOn(leaveRepository, "appendLeaveBalanceLog").mockRejectedValue(new Error("disk full"));

    await expect(review(request.id, "rejected")).rejects.toThrow("disk full");

    expect([await requestRow(request.id), await balanceOf(e.id), await logsOf(e.id)]).toEqual(before);
  });

  it("when fewer hours are pending than the request holds, the review fails instead of clamping to zero", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);
    await db.update(employeeLeaveBalances).set({ pendingHours: 3 }).where(eq(employeeLeaveBalances.employeeId, e.id));
    const before = [await requestRow(request.id), await balanceOf(e.id), await logsOf(e.id)];

    await expect(review(request.id, "approved")).rejects.toMatchObject({ status: 409 });
    await expect(review(request.id, "rejected")).rejects.toMatchObject({ status: 409 });

    expect([await requestRow(request.id), await balanceOf(e.id), await logsOf(e.id)]).toEqual(before);
  });

  it("hours that are not whole numbers add up and settle to exactly zero pending", async () => {
    const e = await employeeWithBalance(16);
    const short = await submitAnnual(e.id, { startTime: "09:00", endTime: "10:20" });
    const long = await submitAnnual(e.id, { startTime: "10:30", endTime: "13:10" });
    expect([short.hours, long.hours]).toEqual([1.33, 2.67]);

    await review(short.id, "approved");
    await review(long.id, "approved");

    const balance = await balanceOf(e.id);
    expect([balance?.pending, Math.round((balance?.used ?? 0) * 100) / 100]).toEqual([0, 4]);
  });
});

describe("hours that float4 cannot hold exactly", () => {
  const fileHours = async (employeeId: number, spans: [string, string][]) => {
    const requests = [];
    for (const [startTime, endTime] of spans) requests.push(await submitAnnual(employeeId, { startTime, endTime }));
    return requests;
  };
  const settled = async (employeeId: number) => {
    const balance = await balanceOf(employeeId);
    return [balance?.pending, Math.round((balance?.used ?? 0) * 100) / 100];
  };

  it("approving the longer of 1.33 and 2.67 hours first, then the shorter, settles to zero pending", async () => {
    const e = await employeeWithBalance(16);
    const [short, long] = await fileHours(e.id, [["09:00", "10:20"], ["10:30", "13:10"]]);

    await review(long.id, "approved");
    await review(short.id, "approved");

    expect(await settled(e.id)).toEqual([0, 4]);
  });

  it("rejecting the longer first, then the shorter, settles to zero pending", async () => {
    const e = await employeeWithBalance(16);
    const [short, long] = await fileHours(e.id, [["09:00", "10:20"], ["10:30", "13:10"]]);

    await review(long.id, "rejected");
    await review(short.id, "rejected");

    expect(await settled(e.id)).toEqual([0, 0]);
  });

  it("three requests of 0.33 hours settle one by one to zero pending", async () => {
    const e = await employeeWithBalance(16);
    const requests = await fileHours(e.id, [["09:00", "09:20"], ["10:00", "10:20"], ["11:00", "11:20"]]);

    for (const request of requests) await review(request.id, "approved");

    expect(await settled(e.id)).toEqual([0, 0.99]);
  });
});

describe("setting the yearly total", () => {
  it("sets the total, keeps used and pending, and logs it", async () => {
    const e = await employeeWithBalance(16);
    const request = await submitAnnual(e.id);
    await review(request.id, "approved");
    await submitAnnual(e.id);

    const balance = await leaveService.adjustBalance(e.id, YEAR, 40, 1, "管理員");

    expect([balance.totalHours, balance.usedHours, balance.pendingHours]).toEqual([40, 8, 8]);
    expect((await logsOf(e.id)).slice(-1)[0]).toMatchObject({ delta: 40, operatedBy: 1 });
  });

  it("two first-time settings at once both succeed and leave one balance row", async () => {
    const e = await employeeWithBalance(null);
    await warmPool(4);

    const results = await concurrently(2, (i) => leaveService.adjustBalance(e.id, YEAR, 40 + i, i + 1, `管理員${i + 1}`));

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const rows = await db.select().from(employeeLeaveBalances).where(eq(employeeLeaveBalances.employeeId, e.id));
    expect(rows).toHaveLength(1);
    expect(await logsOf(e.id)).toHaveLength(2);
  });

  it("when writing the log fails, the total is not set", async () => {
    const e = await employeeWithBalance(null);
    vi.spyOn(leaveRepository, "appendLeaveBalanceLog").mockRejectedValue(new Error("disk full"));

    await expect(leaveService.adjustBalance(e.id, YEAR, 40, 1, "管理員")).rejects.toThrow("disk full");

    expect(await balanceOf(e.id)).toBeUndefined();
  });

  it("refuses a negative total and an unknown employee", async () => {
    const e = await employeeWithBalance(16);

    await expect(leaveService.adjustBalance(e.id, YEAR, -1, 1, "管理員")).rejects.toMatchObject({ status: 400 });
    await expect(leaveService.adjustBalance(999999, YEAR, 8, 1, "管理員")).rejects.toMatchObject({ status: 404 });
  });

describe("the employee's leave balance lock", () => {
  it("filing, approving, rejecting and setting the total all wait for it", async () => {
    const e = await employeeWithBalance(40);
    const toApprove = await submitAnnual(e.id);
    const toReject = await submitAnnual(e.id);
    const held = (operation: () => Promise<unknown>) => runWhileLockHeld(LOCK_NS.leaveBalance, e.id, operation);

    const outcomes = [
      await held(() => submitAnnual(e.id)),
      await held(() => review(toApprove.id, "approved")),
      await held(() => review(toReject.id, "rejected")),
      await held(() => leaveService.adjustBalance(e.id, YEAR, 48, 1, "管理員")),
    ];

    expect(outcomes.map((o) => [o.finishedWhileHeld, o.outcome.status])).toEqual(Array(4).fill([false, "fulfilled"]));
  });
});

});
