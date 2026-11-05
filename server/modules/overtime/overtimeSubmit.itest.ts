import { beforeEach, describe, expect, it } from "vitest";
import { overtimeRequests } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, resetDatabase, warmPool } from "../../test/itest";
import { overtimeService } from "./overtime.service";

const request = (employeeId: number, over: Record<string, unknown> = {}) => ({
  employeeId,
  date: "2026-07-06",
  startTime: "18:00",
  endTime: "19:30",
  reason: "活動延長",
  ...over,
});

beforeEach(async () => {
  await resetDatabase();
});

describe("employee overtime request (T11)", () => {
  it("one request id sent twice at the same moment writes one request, and both answers name it", async () => {
    const region = await createRegion();
    const employee = await createEmployee({ regionId: region.id });
    await warmPool(4);

    const results = await concurrently(2, () => overtimeService.submit(request(employee.id, { requestId: "req-1" }) as any));

    const rows = await db.select().from(overtimeRequests);
    expect(rows).toHaveLength(1);
    expect(results.map((r) => (r.status === "fulfilled" ? (r.value as any).id : r.reason?.message))).toEqual([rows[0].id, rows[0].id]);
  });

  it("one request id sent again later returns the first request and writes nothing", async () => {
    const region = await createRegion();
    const employee = await createEmployee({ regionId: region.id });

    const first: any = await overtimeService.submit(request(employee.id, { requestId: "req-1" }) as any);
    const again: any = await overtimeService.submit(request(employee.id, { requestId: "req-1", reason: "改了原因" }) as any);

    expect(again.id).toBe(first.id);
    expect(again.reason).toBe("活動延長");
    expect(await db.select().from(overtimeRequests)).toHaveLength(1);
  });

  it("two employees may use the same request id", async () => {
    const region = await createRegion();
    const a = await createEmployee({ regionId: region.id });
    const b = await createEmployee({ regionId: region.id });

    await overtimeService.submit(request(a.id, { requestId: "same" }) as any);
    await overtimeService.submit(request(b.id, { requestId: "same" }) as any);

    expect((await db.select().from(overtimeRequests)).map((r) => r.employeeId).sort()).toEqual([a.id, b.id].sort());
  });

  it.each([
    ["end before start", { startTime: "19:00", endTime: "18:00" }],
    ["end equal to start", { startTime: "18:00", endTime: "18:00" }],
    ["a time that is not HH:MM", { endTime: "7pm" }],
    ["an hour past 23", { endTime: "24:30" }],
    ["a date that is not YYYY-MM-DD", { date: "2026/07/06" }],
  ])("refuses %s with 400 and writes nothing", async (_label, over) => {
    const region = await createRegion();
    const employee = await createEmployee({ regionId: region.id });

    const error: any = await overtimeService.submit(request(employee.id, { requestId: "r", ...over }) as any).catch((e) => e);

    expect(error.status).toBe(400);
    expect(await db.select().from(overtimeRequests)).toHaveLength(0);
  });

  it("a refused request does not use up its request id", async () => {
    const region = await createRegion();
    const employee = await createEmployee({ regionId: region.id });

    await overtimeService.submit(request(employee.id, { requestId: "r", endTime: "17:00" }) as any).catch(() => undefined);
    const fixed: any = await overtimeService.submit(request(employee.id, { requestId: "r" }) as any);

    expect(fixed.endTime).toBe("19:30");
    expect(await db.select().from(overtimeRequests)).toHaveLength(1);
  });
});
