import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { employees } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, createEmployee, createRegion, resetDatabase, warmPool } from "../../test/itest";
import { lineUserId } from "../../test/clock";
import { employeeRepository } from "../employee/employee.repository";
import { employeeService } from "../employee/employee.service";
import { handleLineWebhook } from "./lineWebhook.service";

// Nothing may leave this machine; keep what the bot would have said to each sender instead.
const line = vi.hoisted(() => ({ said: new Map<string, string[]>() }));
vi.mock("../../adapters/line", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../adapters/line")>()),
  replyMessages: vi.fn(async (replyToken: string, messages: { text?: string }[]) => {
    line.said.set(replyToken, [...(line.said.get(replyToken) ?? []), ...messages.map((m) => m.text ?? "")]);
    return "ok" as const;
  }),
  pushMessages: vi.fn(async () => true),
}));

const textEvent = (from: string, text: string) => ({
  type: "message",
  webhookEventId: `01BIND-${from.slice(-4)}-${text}`,
  timestamp: Date.now(),
  replyToken: `reply-${from.slice(-4)}`,
  source: { type: "user", userId: from },
  message: { type: "text", id: "1", text },
});
const send = (from: string, text: string) => handleLineWebhook({ events: [textEvent(from, text)] });
const saidTo = (from: string) => (line.said.get(`reply-${from.slice(-4)}`) ?? []).join("\n");
const lineIdOf = async (id: number) => (await db.select().from(employees).where(eq(employees.id, id)))[0].lineId;

/** Make the read-then-write gap wide, wherever the code reads the employee code, so a missing lock shows every run. */
function widenBindingWindow(ms = 80) {
  const pause = () => new Promise((resolve) => setTimeout(resolve, ms));
  const byCodeOnService = employeeService.getEmployeeByCode;
  vi.spyOn(employeeService, "getEmployeeByCode").mockImplementation(async (...args) => {
    const found = await byCodeOnService(...args);
    await pause();
    return found;
  });
  const byCodeOnRepository = employeeRepository.getEmployeeByCode;
  vi.spyOn(employeeRepository, "getEmployeeByCode").mockImplementation(async (...args) => {
    const found = await byCodeOnRepository(...args);
    await pause();
    return found;
  });
}

const A = lineUserId(0xa);
const B = lineUserId(0xb);

beforeEach(async () => {
  await resetDatabase();
  line.said.clear();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("binding a LINE account to an employee code", () => {
  it("binds an active employee and says so", async () => {
    const region = await createRegion();
    const employee = await createEmployee({ regionId: region.id, employeeCode: "1305374" });

    await send(A, "1305374");

    expect(await lineIdOf(employee.id)).toBe(A);
    expect(saidTo(A)).toContain("綁定成功");
  });

  it("refuses a code that another LINE account already holds", async () => {
    const region = await createRegion();
    const employee = await createEmployee({ regionId: region.id, employeeCode: "1305374", lineId: B });

    await send(A, "1305374");

    expect(await lineIdOf(employee.id)).toBe(B);
    expect(saidTo(A)).toContain("已綁定其他 LINE 帳號");
  });

  it("two LINE accounts sending the same code at the same moment: one binds, the other is told it is taken", async () => {
    const region = await createRegion();
    const employee = await createEmployee({ regionId: region.id, employeeCode: "1305374" });
    await warmPool(4);
    widenBindingWindow();

    await concurrently(2, (i) => send(i === 0 ? A : B, "1305374"));

    const winner = await lineIdOf(employee.id);
    const loser = winner === A ? B : A;
    expect([saidTo(winner!).includes("綁定成功"), saidTo(loser).includes("已綁定其他 LINE 帳號"), saidTo(loser).includes("綁定成功")]).toEqual([true, true, false]);
  });

  it("one LINE account sending two different codes at the same moment: only one employee ends up bound to it", async () => {
    const region = await createRegion();
    const first = await createEmployee({ regionId: region.id, employeeCode: "1305374" });
    const second = await createEmployee({ regionId: region.id, employeeCode: "1305375" });
    await warmPool(4);
    widenBindingWindow();

    await concurrently(2, (i) => send(A, i === 0 ? "1305374" : "1305375"));

    const bound = [await lineIdOf(first.id), await lineIdOf(second.id)].filter((id) => id === A);
    expect(bound).toHaveLength(1);
    expect(saidTo(A).match(/綁定成功/g)).toHaveLength(1);
    expect(saidTo(A)).toContain("已綁定為");
  });
});

describe("looking an employee up by LINE id (decision D1)", () => {
  it("returns the active record, not the older inactive one, whatever the insertion order", async () => {
    const region = await createRegion();
    await createEmployee({ regionId: region.id, lineId: A, status: "inactive" });
    const current = await createEmployee({ regionId: region.id, lineId: A });

    expect((await employeeService.getEmployeeByLineId(A))?.id).toBe(current.id);
  });

  it("returns the lowest id when several active records carry it", async () => {
    const region = await createRegion();
    const first = await createEmployee({ regionId: region.id, lineId: A });
    await createEmployee({ regionId: region.id, lineId: A });

    expect((await employeeService.getEmployeeByLineId(A))?.id).toBe(first.id);
  });
});
