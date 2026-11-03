import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockRecords, idempotencyKeys, lineWebhookEvents } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { LAT, LNG, employeeOnShiftNow, lineUserId, widenReadToWriteWindow } from "../../test/clock";
import { liffService } from "../liff/liff.service";
import { handleLineWebhook } from "../line/lineWebhook.service";
import { clockService } from "./clock.service";
import { processClockIn } from "./clockIn.service";
import { invalidateVenueCache } from "./venueCache";

// Nothing may leave this machine; record what the bot would have said instead.
const line = vi.hoisted(() => ({ replies: [] as string[], pushes: [] as string[] }));
vi.mock("../../adapters/line", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../adapters/line")>()),
  replyMessages: vi.fn(async (_token: string, messages: { text?: string }[]) => {
    line.replies.push(...messages.map((m) => m.text ?? ""));
    return "ok" as const;
  }),
  pushMessages: vi.fn(async (_to: string, messages: object[]) => {
    line.pushes.push(...messages.map((m) => JSON.stringify(m)));
    return true;
  }),
}));

const rowsOf = (employeeId: number) => db.select().from(clockRecords).where(eq(clockRecords.employeeId, employeeId));
const summary = (rows: { clockType: string; status: string }[]) => rows.map((r) => `${r.clockType}/${r.status}`);

let eventSeq = 0;
const locationEvent = (userId: string, over: Record<string, unknown> = {}) => ({
  type: "message",
  webhookEventId: `01TESTEVENT${String((eventSeq += 1)).padStart(6, "0")}`,
  timestamp: Date.now(),
  replyToken: "reply-token",
  source: { type: "user", userId },
  message: { type: "location", id: "1", latitude: LAT, longitude: LNG },
  ...over,
});
const deliver = (...events: unknown[]) => handleLineWebhook({ events });

beforeEach(async () => {
  await resetDatabase();
  invalidateVenueCache();
  line.replies.length = 0;
  line.pushes.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a clock-in request sent twice with the same request id", () => {
  it("writes one row and the second answer is the first answer", async () => {
    const { employee } = await employeeOnShiftNow();
    const body = { employeeId: employee.id, latitude: LAT, longitude: LNG, accuracy: 10, requestId: "press-1" };

    const first = await liffService.processLiffClockIn(body);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await liffService.processLiffClockIn(body);

    expect(second).toEqual(first);
    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
    expect(await db.select().from(idempotencyKeys)).toHaveLength(1);
  });

  it("pushes the clock-in message to LINE for the first answer only", async () => {
    const { employee } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    const body = { employeeId: employee.id, latitude: LAT, longitude: LNG, accuracy: 10, requestId: "press-1" };

    await liffService.processLiffClockIn(body);
    const pushedForFirst = line.pushes.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await liffService.processLiffClockIn(body);

    expect(line.pushes.some((text) => text.includes("上班打卡成功"))).toBe(true);
    expect(line.pushes).toHaveLength(pushedForFirst);
  });

  it("is also answered once when both copies arrive at the same moment", async () => {
    const { employee } = await employeeOnShiftNow();
    await warmPool(4);
    const body = { employeeId: employee.id, latitude: LAT, longitude: LNG, accuracy: 10, requestId: "press-1" };

    const settled = await concurrently(4, () => liffService.processLiffClockIn(body));

    const answers = settled.map((r) => (r.status === "fulfilled" ? r.value : r.reason));
    expect(answers).toEqual(Array(4).fill(answers[0]));
    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
  });

  it("does not hand one employee's answer to another employee who sends the same id", async () => {
    const { employee, region, venue } = await employeeOnShiftNow();
    const other = await employeeOnShiftNow({}, region, venue);

    const first = await liffService.processLiffClockIn({ employeeId: employee.id, latitude: LAT, longitude: LNG, requestId: "shared-id" });
    const second = await liffService.processLiffClockIn({ employeeId: other.employee.id, latitude: LAT, longitude: LNG, requestId: "shared-id" });

    expect(first.status === "success" && second.status === "success" && first.recordId !== second.recordId).toBe(true);
    expect(summary(await rowsOf(other.employee.id))).toEqual(["in/success"]);
  });

  it("still clocks in when an older page sends no request id", async () => {
    const { employee } = await employeeOnShiftNow();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await liffService.processLiffClockIn({ employeeId: employee.id, latitude: LAT, longitude: LNG });

    expect(result.status).toBe("success");
    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
    expect(await db.select().from(idempotencyKeys)).toEqual([]);
  });
});

describe("a clock-in that fails after its row was written", () => {
  it("leaves neither the clock row nor the request id behind", async () => {
    const { employee } = await employeeOnShiftNow();
    const write = clockService.createClockRecord;
    vi.spyOn(clockService, "createClockRecord").mockImplementation(async (data, tx) => {
      await write(data, tx);
      throw new Error("connection lost after the insert");
    });

    await expect(processClockIn({ employeeId: employee.id }, LAT, LNG, { requestId: "press-1" })).rejects.toThrow("connection lost after the insert");

    expect(await rowsOf(employee.id)).toEqual([]);
    expect(await db.select().from(idempotencyKeys)).toEqual([]);
  });

  it("lets the same request id succeed on the retry", async () => {
    const { employee } = await employeeOnShiftNow();
    const write = clockService.createClockRecord;
    const failOnce = vi.spyOn(clockService, "createClockRecord").mockImplementationOnce(async (data, tx) => {
      await write(data, tx);
      throw new Error("connection lost after the insert");
    });
    await expect(processClockIn({ employeeId: employee.id }, LAT, LNG, { requestId: "press-1" })).rejects.toThrow();
    failOnce.mockRestore();

    const retry = await processClockIn({ employeeId: employee.id }, LAT, LNG, { requestId: "press-1" });

    expect([retry.result.status, retry.replayed]).toEqual(["success", false]);
    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
  });
});

describe("a repeat clock-in whose audit row cannot be written", () => {
  it("still answers with the repeat-clock-in failure and keeps the clock-in that was already there", async () => {
    const { employee, venue, shift } = await employeeOnShiftNow();
    await db.insert(clockRecords).values({
      employeeId: employee.id,
      venueId: venue.id,
      shiftId: shift.id,
      clockType: "in",
      latitude: LAT,
      longitude: LNG,
      status: "success",
      clockTime: new Date(Date.now() - 3 * 60_000),
    });
    const write = clockService.createClockRecord;
    vi.spyOn(clockService, "createClockRecord").mockImplementation(async (data, tx) => {
      if (data.status === "fail") await (tx ?? db).execute(sql`select 1 / 0`);
      return write(data, tx);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const outcome = await processClockIn({ employeeId: employee.id }, LAT, LNG, { forcedClockType: "in" });

    expect([outcome.result.status, outcome.result.failReason]).toEqual(["fail", expect.stringContaining("重複打卡")]);
    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
  });
});

describe("LINE location messages", () => {
  it("record the time LINE says the person sent it, not the time the server got to it", async () => {
    const { employee } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    const sentAt = Date.now() - 90_000;

    await deliver(locationEvent(lineUserId(1), { timestamp: sentAt }));

    const [row] = await rowsOf(employee.id);
    expect(row.clockTime?.getTime()).toBe(sentAt);
  });

  it("sent long before the server handles it, record the time it is handled so no row lands before an earlier clock-in", async () => {
    const { employee, venue, shift } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    const clockedInAt = new Date(Date.now() - 30 * 60_000);
    await db.insert(clockRecords).values({
      employeeId: employee.id,
      venueId: venue.id,
      shiftId: shift.id,
      clockType: "in",
      latitude: LAT,
      longitude: LNG,
      status: "success",
      clockTime: clockedInAt,
    });

    const handledFrom = Date.now();
    await deliver(locationEvent(lineUserId(1), { timestamp: clockedInAt.getTime() - 10 * 60_000 }));

    const times = (await rowsOf(employee.id)).map((r) => r.clockTime!.getTime());
    expect(times.every((t) => t >= clockedInAt.getTime())).toBe(true);
    expect(Math.max(...times)).toBeGreaterThanOrEqual(handledFrom);
  });

  it("stamped in the future, record the time it is handled", async () => {
    const { employee } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    const handledFrom = Date.now();

    await deliver(locationEvent(lineUserId(1), { timestamp: handledFrom + 10 * 60_000 }));

    const [row] = await rowsOf(employee.id);
    expect(row.clockTime!.getTime()).toBeGreaterThanOrEqual(handledFrom);
    expect(row.clockTime!.getTime()).toBeLessThan(handledFrom + 60_000);
  });

  it("redelivered 3 minutes later after a clock-in, add nothing", async () => {
    const { employee } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    const event = locationEvent(lineUserId(1));

    await deliver(event);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * 60_000);
    await deliver(event);

    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
  });

  it("redelivered 3 minutes later after a clock-out, do not record a second clock-out", async () => {
    const { employee, venue, shift } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    await db.insert(clockRecords).values({
      employeeId: employee.id,
      venueId: venue.id,
      shiftId: shift.id,
      clockType: "in",
      latitude: LAT,
      longitude: LNG,
      status: "success",
      clockTime: new Date(Date.now() - 10 * 60_000),
    });
    const event = locationEvent(lineUserId(1));

    await deliver(event);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * 60_000);
    await deliver(event);

    expect(summary(await rowsOf(employee.id)).sort()).toEqual(["in/success", "out/success"]);
  });

  it("are written down in line_webhook_events before and after they are handled", async () => {
    await employeeOnShiftNow({ lineId: lineUserId(1) });
    const event = locationEvent(lineUserId(1));

    await deliver(event);

    const rows = await db.select().from(lineWebhookEvents);
    expect(rows.map((r) => [r.eventId, r.status, r.processedAt !== null, r.error])).toEqual([[event.webhookEventId, "done", true, null]]);
  });

  it("without an event id are still handled", async () => {
    const { employee } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await deliver(locationEvent(lineUserId(1), { webhookEventId: undefined }));

    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
  });
});

describe("a LIFF clock-in and a LINE location message for one person at the same moment", () => {
  it("a location message stamped a few seconds before the LIFF clock-in that just committed adds no clock-out", async () => {
    const { employee } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    const sentAt = Date.now() - 4_000;

    await liffService.processLiffClockIn({ employeeId: employee.id, latitude: LAT, longitude: LNG, accuracy: 10 });
    await deliver(locationEvent(lineUserId(1), { timestamp: sentAt }));

    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
  });

  it("record one clock-in, even when LINE's event time is a few seconds older than the LIFF request", async () => {
    const { employee } = await employeeOnShiftNow({ lineId: lineUserId(1) });
    await warmPool(8);
    widenReadToWriteWindow();

    const settled = await concurrently(6, async (i) => {
      if (i % 2 === 0) {
        await liffService.processLiffClockIn({ employeeId: employee.id, latitude: LAT, longitude: LNG, accuracy: 10, requestId: `press-${i}` });
      } else {
        await deliver(locationEvent(lineUserId(1), { timestamp: Date.now() - 4_000 }));
      }
    });

    expect(settled.filter((r) => r.status === "rejected")).toEqual([]);
    expect(summary(await rowsOf(employee.id))).toEqual(["in/success"]);
  });
});

describe("one LINE account bound to several employee records (decision D1)", () => {
  const id = lineUserId(7);

  it("clocks the active record when an older inactive one carries the same LINE id", async () => {
    const region = await createRegion();
    const venue = await createVenue({ regionId: region.id, latitude: LAT, longitude: LNG, radius: 200 });
    const old = await createEmployee({ regionId: region.id, lineId: id, status: "inactive" });
    const current = await employeeOnShiftNow({ lineId: id }, region, venue);

    const outcome = await processClockIn({ lineUserId: id }, LAT, LNG);

    expect([outcome.result.status, outcome.employeeId]).toEqual(["success", current.employee.id]);
    expect(await rowsOf(old.id)).toEqual([]);
    expect(summary(await rowsOf(current.employee.id))).toEqual(["in/success"]);
  });

  it("with two active records in different regions clocks the one in the region of the venue", async () => {
    const north = await createRegion();
    const south = await createRegion();
    const northVenue = await createVenue({ regionId: north.id, latitude: LAT + 1, longitude: LNG, radius: 200 });
    const southVenue = await createVenue({ regionId: south.id, latitude: LAT, longitude: LNG, radius: 200 });
    await employeeOnShiftNow({ lineId: id }, north, northVenue);
    const southEmployee = await employeeOnShiftNow({ lineId: id }, south, southVenue);

    const outcome = await processClockIn({ lineUserId: id }, LAT, LNG);

    expect([outcome.result.status, outcome.employeeId]).toEqual(["success", southEmployee.employee.id]);
  });

  it("with two active records and no region match clocks the lowest id and says so in the log", async () => {
    const region = await createRegion();
    const elsewhere = await createRegion();
    const venue = await createVenue({ regionId: elsewhere.id, latitude: LAT, longitude: LNG, radius: 200 });
    const first = await employeeOnShiftNow({ lineId: id }, region, venue);
    await employeeOnShiftNow({ lineId: id }, region, venue);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const outcome = await processClockIn({ lineUserId: id }, LAT, LNG);

    expect(outcome.employeeId).toBe(first.employee.id);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`emp#${first.employee.id}`));
  });
});
