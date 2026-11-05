import type { AddressInfo } from "node:net";
import express from "express";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockRecords, employees, guidelines, notificationRecipients, systemConfigs } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, createShift, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { lineUserId } from "../../test/clock";
import { registerInternalApi } from "../internal/internal.routes";
import { syncService } from "../sync/sync.service";
import { systemService } from "../system/system.service";
import { checkMissingClockIn, pushPendingGuidelinesIfAny, sendAvailabilityReminders, sendShiftReminders, sendWeeklyLateReport, sendWeeklySchedulePush } from "./linePush.service";

// Nothing may leave this machine: LINE and mail are stubs that remember what they were asked to send.
type Behaviour = "ok" | "fail" | "throw-after-push";
const outbox = vi.hoisted(() => ({
  pushes: [] as string[],
  behaviour: new Map<string, "ok" | "fail" | "throw-after-push">(),
  delayMs: 0,
  mails: [] as string[],
}));
vi.mock("../../adapters/line", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../adapters/line")>()),
  pushMessages: vi.fn(async (to: string) => {
    if (outbox.delayMs) await new Promise((resolve) => setTimeout(resolve, outbox.delayMs));
    outbox.pushes.push(to);
    const how = outbox.behaviour.get(to) ?? "ok";
    if (how === "throw-after-push") throw new Error("process died right after LINE accepted the message");
    return how === "ok";
  }),
}));
vi.mock("../../adapters/mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../adapters/mail")>()),
  sendMail: vi.fn(async (message: { subject: string }) => {
    outbox.mails.push(message.subject);
  }),
}));

// Friday 2026-07-03 19:00 Taipei: tomorrow is 07-04, next week starts Monday 07-06, last week started Monday 06-22.
vi.mock("./lineHelpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lineHelpers")>()),
  getTaiwanNow: vi.fn(() => new Date(2026, 6, 3, 19, 0, 0)),
}));

const pushesTo = (lineId: string) => outbox.pushes.filter((to) => to === lineId).length;
const setBehaviour = (lineId: string, how: Behaviour) => outbox.behaviour.set(lineId, how);

/** Three employees with a LINE account, each on shift at the same venue on every date given. */
async function crew(dates: string[], start = "09:00", end = "18:00") {
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id });
  const people = [];
  for (const n of [1, 2, 3]) {
    const employee = await createEmployee({ regionId: region.id, lineId: lineUserId(0x100 + n) });
    for (const date of dates) await createShift({ employeeId: employee.id, venueId: venue.id, date, startTime: start, endTime: end });
    people.push({ employee, lineId: employee.lineId! });
  }
  return people;
}

beforeEach(async () => {
  await resetDatabase();
  outbox.pushes.length = 0;
  outbox.mails.length = 0;
  outbox.behaviour.clear();
  outbox.delayMs = 0;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("weekly schedule push", () => {
  it("gives each employee one message when two instances run it at the same time", async () => {
    const people = await crew(["2026-07-06"]);
    outbox.delayMs = 40;
    await warmPool(4);

    await concurrently(2, () => sendWeeklySchedulePush());

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });

  it("pushes only to the employee whose push failed on the next round", async () => {
    const people = await crew(["2026-07-06"]);
    setBehaviour(people[0].lineId, "fail");

    const first = await sendWeeklySchedulePush();
    setBehaviour(people[0].lineId, "ok");
    const second = await sendWeeklySchedulePush();

    expect([first, second]).toEqual([
      { sent: 2, skipped: 1, noLineId: 0 },
      { sent: 1, skipped: 2, noLineId: 0 },
    ]);
    expect(people.map((p) => pushesTo(p.lineId))).toEqual([2, 1, 1]);
  });

  it("keeps going after a push died halfway, and does not push that employee again", async () => {
    const people = await crew(["2026-07-06"]);
    setBehaviour(people[0].lineId, "throw-after-push");

    const first = await sendWeeklySchedulePush();
    setBehaviour(people[0].lineId, "ok");
    await sendWeeklySchedulePush();

    expect(first).toMatchObject({ sent: 2 });
    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });
});

describe("internal weekly schedule trigger", () => {
  it("pushes one round when it is called twice", async () => {
    const people = await crew(["2026-07-06"]);
    process.env.INTERNAL_API_TOKEN = "itest-token";
    const app = express();
    registerInternalApi(app);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/internal/trigger-weekly-schedule`;
      for (let i = 0; i < 2; i += 1) {
        const res = await fetch(url, { method: "POST", headers: { "x-internal-token": "itest-token" } });
        expect(res.status).toBe(200);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });
});

describe("a scheduled job runs one at a time", () => {
  it("turns a second run of the same job away while the first is still running", async () => {
    await crew(["2026-07-06"]);
    outbox.delayMs = 150;
    await warmPool(4);

    const results = await concurrently(2, () => syncService.weeklySchedule());

    const values = results.map((r) => (r.status === "fulfilled" ? r.value : r.reason));
    expect(values.filter((v) => "busy" in v)).toEqual([{ busy: true }]);
  });
});

describe("tomorrow shift reminder", () => {
  it("gives each employee one message when two instances run it at the same time", async () => {
    const people = await crew(["2026-07-04"]);
    outbox.delayMs = 40;
    await warmPool(4);

    await concurrently(2, () => sendShiftReminders());

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });

  it("does not remind again on a second run, and retries only a failed push", async () => {
    const people = await crew(["2026-07-04"]);
    setBehaviour(people[1].lineId, "fail");

    await sendShiftReminders();
    setBehaviour(people[1].lineId, "ok");
    const second = await sendShiftReminders();

    expect(second.sent).toBe(1);
    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 2, 1]);
  });
});

describe("missing clock-in reminder", () => {
  it("pushes again on the next run when LINE refused the first push", async () => {
    const people = await crew(["2026-07-03"]);
    setBehaviour(people[0].lineId, "fail");

    const first = await checkMissingClockIn();
    setBehaviour(people[0].lineId, "ok");
    const second = await checkMissingClockIn();

    expect(first.notified).toBe(2);
    expect(second.notified).toBe(1);
    expect(people.map((p) => pushesTo(p.lineId))).toEqual([2, 1, 1]);
  });

  it("does not remind an employee a second time once the push went through", async () => {
    const people = await crew(["2026-07-03"]);

    await checkMissingClockIn();
    await checkMissingClockIn();

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });

  it("does not push again after a push died halfway", async () => {
    const people = await crew(["2026-07-03"]);
    setBehaviour(people[0].lineId, "throw-after-push");

    await checkMissingClockIn();
    setBehaviour(people[0].lineId, "ok");
    await checkMissingClockIn();

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });

  it("mails the managers once per employee, also when a push is retried or there is no LINE account to push to", async () => {
    const people = await crew(["2026-07-03"]);
    await db.update(employees).set({ lineId: null }).where(eq(employees.id, people[2].employee.id));
    await db.insert(notificationRecipients).values({ email: "manager@example.invalid" });
    setBehaviour(people[0].lineId, "fail");

    await checkMissingClockIn();
    setBehaviour(people[0].lineId, "ok");
    await checkMissingClockIn();
    await checkMissingClockIn();

    expect(outbox.mails).toHaveLength(1);
    expect(pushesTo(people[0].lineId)).toBe(2);
  });

  it("gives each employee one message when two instances run it at the same time", async () => {
    const people = await crew(["2026-07-03"]);
    outbox.delayMs = 40;
    await warmPool(4);

    await concurrently(2, () => checkMissingClockIn());

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });
});

describe("weekly late report", () => {
  it("gives each employee one message when two instances run it at the same time", async () => {
    const people = await crew(["2026-06-22"]);
    for (const { employee } of people) {
      await db.insert(clockRecords).values({
        employeeId: employee.id,
        clockType: "in",
        latitude: 25,
        longitude: 121.5,
        status: "success",
        clockTime: new Date("2026-06-22T09:30:00+08:00"),
      });
    }
    outbox.delayMs = 40;
    await warmPool(4);

    await concurrently(2, () => sendWeeklyLateReport());

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });
});

describe("availability reminder", () => {
  async function openWindow() {
    const value = JSON.stringify({ targetYearMonth: "2026-08", windows: [{ openFrom: "2026-07-01", openUntil: "2026-07-05" }] });
    await db.insert(systemConfigs).values({ key: "availability_window", value });
  }

  it("reminds each employee once a day however often it runs", async () => {
    const people = await crew([]);
    await openWindow();

    await sendAvailabilityReminders();
    await sendAvailabilityReminders();

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });

  it("gives each employee one message when two instances run it at the same time", async () => {
    const people = await crew([]);
    await openWindow();
    outbox.delayMs = 40;
    await warmPool(4);

    await concurrently(2, () => sendAvailabilityReminders());

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
  });
});

describe("pending guideline push after a clock-in", () => {
  async function unreadGuideline() {
    await db.insert(guidelines).values({ category: "confidentiality", title: "保密守則" });
  }

  it("pushes the same notice once", async () => {
    const [person] = await crew([]);
    await unreadGuideline();

    await pushPendingGuidelinesIfAny(person.employee.id, person.lineId);
    await pushPendingGuidelinesIfAny(person.employee.id, person.lineId);

    expect(pushesTo(person.lineId)).toBe(1);
  });

  it("tries again at the next clock-in when LINE refused the push", async () => {
    const [person] = await crew([]);
    await unreadGuideline();
    setBehaviour(person.lineId, "fail");

    await pushPendingGuidelinesIfAny(person.employee.id, person.lineId);
    setBehaviour(person.lineId, "ok");
    await pushPendingGuidelinesIfAny(person.employee.id, person.lineId);
    await pushPendingGuidelinesIfAny(person.employee.id, person.lineId);

    expect(pushesTo(person.lineId)).toBe(2);
  });
});

describe("weekly attendance notice", () => {
  it("sends each employee and the managers one message however often it is triggered", async () => {
    const people = await crew(["2026-06-22"]);
    await db.insert(notificationRecipients).values({ email: "manager@example.invalid" });

    await systemService.notifyWeeklyAttendance("2026-06-22");
    await systemService.notifyWeeklyAttendance("2026-06-22");

    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
    expect(outbox.mails).toHaveLength(1);
  });

  it("mails the managers again only if the first mail was refused, and does not push the employees again", async () => {
    const people = await crew(["2026-06-22"]);
    await db.insert(notificationRecipients).values({ email: "manager@example.invalid" });
    const { sendMail } = await import("../../adapters/mail");
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("SMTP refused"));

    const first = await systemService.notifyWeeklyAttendance("2026-06-22");
    const second = await systemService.notifyWeeklyAttendance("2026-06-22");

    expect([first.emailSent, second.emailSent]).toEqual([false, true]);
    expect(people.map((p) => pushesTo(p.lineId))).toEqual([1, 1, 1]);
    expect(outbox.mails).toHaveLength(1);
  });
});
