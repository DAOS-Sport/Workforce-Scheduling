import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { employees, ragicSyncEvents, venues } from "@shared/schema";
import { db, pool } from "../../infra/db";
import { LOCK_NS, withSessionLock } from "../../infra/db/tx";
import { createEmployee, createRegion, createVenue, resetDatabase, warmPool } from "../../test/itest";
import { readJobState } from "../../shared/health/healthState";
import { dispatchService } from "../dispatch/dispatch.service";
import { employeeRepository } from "../employee/employee.repository";
import { employeeService } from "../employee/employee.service";
import { cancelScheduledDrain, drainRagicEvents, runRagicSync, syncFromRagic } from "./ragic.service";
import { mountRagicRoutes } from "./ragic.routes";

// Ragic is always a stub here; nothing leaves this machine.
const ragic = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../adapters/ragic", () => ({ fetchAllRagicRecords: ragic.fetch, fetchH02RagicRecords: async () => ({}) }));

const SECRET = "test-webhook-secret";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function record(code: string, overrides: Record<string, unknown> = {}) {
  return {
    姓名: `虛構${code}`,
    員工編號: code,
    部門: ["新北高中"],
    應徵職務: ["救生員"],
    聘雇類別: "兼職",
    在職狀態: "在職",
    手機: "0900000001",
    電子郵件信箱: `${code.toLowerCase()}@example.invalid`,
    "個人LINE ID": "",
    ...overrides,
  };
}
const snapshot = (...records: Array<ReturnType<typeof record>>) => Object.fromEntries(records.map((r, i) => [String(i + 1), r]));
const codes = (n: number) => Array.from({ length: n }, (_, i) => `E${String(i + 1).padStart(3, "0")}`);

/** A promise the test settles by hand, so a stubbed Ragic fetch stays "slow" exactly as long as the test wants. */
function gate<T = void>() {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (open = resolve));
  return { promise, open };
}

async function eventually(check: () => Promise<boolean>, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error("condition not reached in time");
}

let server: Server;
let base: string;
const post = (path: string, init: { headers?: Record<string, string>; body?: unknown } = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(init.body ?? {}),
  });
const webhook = (headers: Record<string, string> = {}) => post("/api/ragic/webhook/h01", { headers: { "x-ragic-webhook-secret": SECRET, ...headers } });

const statusOf = async (code: string) => (await db.select().from(employees).where(eq(employees.employeeCode, code)))[0]?.status;
const eventRows = () => db.select().from(ragicSyncEvents);
const regionA = () => createRegion({ code: "A", name: "A 區" });

beforeEach(async () => {
  await resetDatabase();
  await warmPool(4);
  process.env.RAGIC_API_KEY = "test-key";
  process.env.RAGIC_WEBHOOK_SECRET = SECRET;
  process.env.RAGIC_WEBHOOK_DEBOUNCE_MS = "80";
  ragic.fetch.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const app = express();
  app.use(express.json());
  server = app.listen(0);
  mountRagicRoutes(server, app);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  cancelScheduledDrain();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("drop trigger if exists fail_employee_insert on employees");
  await pool.query("drop function if exists fail_employee_insert()");
  vi.restoreAllMocks();
  delete process.env.RAGIC_WEBHOOK_DEBOUNCE_MS;
});

describe("Ragic employee sync: one at a time (T76)", () => {
  it("answers 202 to a second sync that starts while the first is fetching, and the newer snapshot wins once it is replayed", async () => {
    const region = await regionA();
    await createEmployee({ regionId: region.id, employeeCode: "E001", role: "救生", employmentType: "part_time", department: "新北高中" });
    const slowOld = gate<Record<string, unknown>>();
    let fetchStarted = 0;
    ragic.fetch.mockImplementation(async () => {
      fetchStarted++;
      // The first fetch is the old, slow snapshot; every later one is the newer snapshot.
      return fetchStarted === 1 ? slowOld.promise : snapshot(record("E001", { 在職狀態: "離職" }));
    });

    const first = post("/api/ragic-sync");
    await eventually(async () => fetchStarted === 1);
    const second = await post("/api/ragic-sync");
    expect(second.status).toBe(202);

    slowOld.open(snapshot(record("E001")));
    expect((await first).status).toBe(200);
    expect(await statusOf("E001")).toBe("active");

    cancelScheduledDrain();
    await drainRagicEvents();
    expect(await statusOf("E001")).toBe("inactive");
    expect((await eventRows()).map((e) => e.status)).toEqual(["done"]);
  });

  it("takes the same lock for the webhook, the scheduled run and both manual URLs, and leaves the missed work pending", async () => {
    const region = await regionA();
    await createEmployee({ regionId: region.id, employeeCode: "E001", role: "救生", department: "新北高中" });
    ragic.fetch.mockResolvedValue(snapshot(record("E001")));

    const held = gate();
    const holding = withSessionLock(LOCK_NS.ragicSync, 0, () => held.promise);
    await sleep(100);

    const scheduled = await runRagicSync("cron");
    const hook = await webhook();
    const legacy = await post("/api/ragic-sync");
    const modern = await post("/api/ragic/sync-employees");
    held.open();
    await holding;

    expect(scheduled).toEqual({ busy: true });
    expect([hook.status, legacy.status, modern.status]).toEqual([202, 202, 202]);
    expect(ragic.fetch).not.toHaveBeenCalled();
    const sources = (await eventRows()).map((e) => `${e.source}:${e.status}`).sort();
    expect(sources).toEqual(["cron:pending", "manual:pending", "manual:pending", "webhook:pending"]);
  });

  it("keeps a venue sync from running twice at once, so one Ragic department creates one venue", async () => {
    await regionA();
    const slow = gate<Record<string, unknown>>();
    ragic.fetch.mockImplementation(() => slow.promise);

    const first = post("/api/ragic/sync-venues");
    await eventually(async () => ragic.fetch.mock.calls.length === 1);
    const second = await post("/api/ragic/sync-venues");
    slow.open(snapshot(record("E001", { 部門: ["新北高中"] })));
    const firstBody = await (await first).json();

    expect(second.status).toBe(202);
    expect(firstBody.created).toBe(1);
    expect(await db.select().from(venues)).toHaveLength(1);
  });

  it("creates a venue with the known coordinates and radius, not null ones", async () => {
    await regionA();
    ragic.fetch.mockResolvedValue(snapshot(record("E001", { 部門: ["新北高中"] })));

    expect((await post("/api/ragic/sync-venues")).status).toBe(200);

    const [venue] = await db.select().from(venues);
    expect([venue.latitude, venue.longitude, venue.radius]).toEqual([expect.closeTo(25.08725, 4), expect.closeTo(121.49125, 4), 200]);
  });
});

describe("Ragic webhook (#2)", () => {
  it("records the event and answers before the sync has finished", async () => {
    const region = await regionA();
    await createEmployee({ regionId: region.id, employeeCode: "E001", role: "救生", department: "新北高中" });
    let fetchFinished = false;
    ragic.fetch.mockImplementation(async () => {
      await sleep(400);
      fetchFinished = true;
      return snapshot(record("E001"));
    });

    const res = await webhook();

    expect(res.status).toBe(202);
    expect(fetchFinished).toBe(false);
    expect((await eventRows()).map((e) => e.source)).toEqual(["webhook"]);
    expect((await readJobState("ragic.webhook"))?.lastStatus).toBe("success");
    await eventually(async () => (await eventRows()).every((e) => e.status === "done"));
  });

  it("merges ten deliveries into one sync and marks all ten done", async () => {
    const region = await regionA();
    await createEmployee({ regionId: region.id, employeeCode: "E001", role: "救生", department: "新北高中" });
    ragic.fetch.mockResolvedValue(snapshot(record("E001")));

    const responses = await Promise.all(Array.from({ length: 10 }, () => webhook()));

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(202));
    await eventually(async () => {
      const rows = await eventRows();
      return rows.length === 10 && rows.every((e) => e.status === "done");
    });
    expect(ragic.fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores a delivery that repeats an event id Ragic sent", async () => {
    ragic.fetch.mockResolvedValue(snapshot(record("E001")));

    const a = await webhook({ "x-ragic-event-id": "evt-1" });
    const b = await webhook({ "x-ragic-event-id": "evt-1" });

    expect([a.status, b.status]).toEqual([202, 202]);
    expect((await b.json()).duplicate).toBe(true);
    expect(await eventRows()).toHaveLength(1);
  });

  it("keeps events of a failed sync in the table, and the next successful sync settles them", async () => {
    const region = await regionA();
    await createEmployee({ regionId: region.id, employeeCode: "E001", role: "救生", department: "新北高中" });
    ragic.fetch.mockRejectedValueOnce(new Error("Ragic HTTP 503"));

    await webhook();
    await eventually(async () => (await eventRows()).every((e) => e.status === "failed"));
    expect((await eventRows())[0].error).toContain("503");

    ragic.fetch.mockResolvedValue(snapshot(record("E001")));
    expect((await post("/api/ragic-sync")).status).toBe(200);
    expect((await eventRows()).map((e) => e.status)).toEqual(["done"]);
  });
});

describe("Ragic snapshot handling (#1, #11)", () => {
  const seedLocals = async (n: number) => {
    const region = await regionA();
    for (const code of codes(n)) await createEmployee({ regionId: region.id, employeeCode: code, role: "救生", department: "新北高中" });
  };
  const activeCount = async () => (await db.select().from(employees)).filter((e) => e.status === "active").length;

  it("deactivates everyone a short list leaves out, without asking for confirmation", async () => {
    await seedLocals(10);
    ragic.fetch.mockResolvedValue(snapshot(...codes(5).map((c) => record(c))));

    const res = await post("/api/ragic-sync");

    expect(res.status).toBe(200);
    expect((await res.json()).deactivated).toBe(5);
    expect(await activeCount()).toBe(5);
    expect(await statusOf("E006")).toBe("inactive");
    expect((await readJobState("ragic.sync"))?.lastStatus).toBe("success");
  });

  it("treats an empty snapshot as incomplete, and says so in the job state", async () => {
    await seedLocals(3);
    ragic.fetch.mockResolvedValue({});

    const res = await post("/api/ragic-sync");

    expect(res.status).toBe(409);
    expect(await activeCount()).toBe(3);
    const state = await readJobState("ragic.sync");
    expect([state?.lastStatus, state?.lastError]).toEqual(["failed", expect.stringContaining("0 筆")]);
  });

  it("counts a record with a blank name as listed, so its employee is not deactivated", async () => {
    await seedLocals(10);
    ragic.fetch.mockResolvedValue(snapshot(...codes(10).map((c) => (c === "E005" ? record(c, { 姓名: "" }) : record(c)))));

    expect((await post("/api/ragic-sync")).status).toBe(200);
    expect(await statusOf("E005")).toBe("active");
    expect(await activeCount()).toBe(10);
  });

  it("still deactivates the one employee who really is gone", async () => {
    await seedLocals(10);
    ragic.fetch.mockResolvedValue(snapshot(...codes(9).map((c) => record(c))));

    const res = await post("/api/ragic-sync");

    expect(res.status).toBe(200);
    expect((await res.json()).deactivated).toBe(1);
    expect(await statusOf("E010")).toBe("inactive");
  });
});

describe("Ragic sync writes all or nothing", () => {
  it("rolls back every employee written in the round when one write fails", async () => {
    await regionA();
    await pool.query(`
      create function fail_employee_insert() returns trigger language plpgsql as $$
      begin if new.employee_code = 'E003' then raise exception 'injected failure'; end if; return new; end $$`);
    await pool.query("create trigger fail_employee_insert before insert on employees for each row execute function fail_employee_insert()");
    ragic.fetch.mockResolvedValue(snapshot(...codes(4).map((c) => record(c))));

    const res = await post("/api/ragic-sync");

    expect(res.status).toBe(500);
    expect(await db.select().from(employees)).toHaveLength(0);
    expect((await readJobState("ragic.sync"))?.lastStatus).toBe("failed");
  });

  it("still reports an employee it skips for a business reason, without failing the round", async () => {
    await regionA();
    ragic.fetch.mockResolvedValue(snapshot(record("E001"), record("E002", { 部門: ["沒有這個部門"] })));

    const res = await post("/api/ragic-sync");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect([body.created, body.skipped, body.errors.length]).toEqual([1, 1, 1]);
  });

  it("links dispatch shifts to employees the sync created, as the admin form does", async () => {
    await regionA();
    const reconcile = vi.spyOn(dispatchService, "reconcileDispatchLinks").mockResolvedValue(undefined as never);
    ragic.fetch.mockResolvedValue(snapshot(record("E001")));

    await post("/api/ragic-sync");
    expect(reconcile).toHaveBeenCalledTimes(1);

    reconcile.mockClear();
    await post("/api/ragic-sync");
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe("Ragic sync and a manual status edit (field ownership)", () => {
  const edit = (code: string, status: "active" | "inactive") =>
    employeeService.getEmployeeByCode(code).then((e) => employeeService.update(e!.id, { status }));

  it("keeps an administrator's manual resignation until Ragic itself changes the status", async () => {
    await regionA();
    ragic.fetch.mockResolvedValue(snapshot(record("E001")));
    await post("/api/ragic-sync");
    expect(await statusOf("E001")).toBe("active");

    await edit("E001", "inactive");
    await post("/api/ragic-sync");
    expect(await statusOf("E001")).toBe("inactive");

    ragic.fetch.mockResolvedValue(snapshot(record("E001", { 在職狀態: "離職" })));
    await post("/api/ragic-sync");
    expect(await statusOf("E001")).toBe("inactive");

    ragic.fetch.mockResolvedValue(snapshot(record("E001")));
    await post("/api/ragic-sync");
    expect(await statusOf("E001")).toBe("active");
  });

  it("keeps a manual reinstatement while Ragic still says the employee has left", async () => {
    const region = await regionA();
    await createEmployee({ regionId: region.id, employeeCode: "E001", role: "救生", department: "新北高中" });
    ragic.fetch.mockResolvedValue(snapshot(record("E001", { 在職狀態: "離職" })));
    await post("/api/ragic-sync");
    expect(await statusOf("E001")).toBe("inactive");
    await edit("E001", "active");

    await post("/api/ragic-sync");

    expect(await statusOf("E001")).toBe("active");
  });

  it("still lets Ragic decide the status of an employee it has not reported on before", async () => {
    const region = await regionA();
    await createEmployee({ regionId: region.id, employeeCode: "E001", role: "救生", status: "inactive", department: "新北高中" });
    ragic.fetch.mockResolvedValue(snapshot(record("E001")));

    await syncFromRagic();

    expect(await statusOf("E001")).toBe("active");
  });
});

describe("Ragic sync does not overwrite a LINE account that was bound a moment ago", () => {
  const lineIdOf = async (id: number) => (await employeeRepository.getEmployee(id))!.lineId;
  const bound = "U" + "a".repeat(32);

  it("leaves a valid bound id alone when Ragic carries something that is not a LINE user id", async () => {
    const region = await regionA();
    const emp = await createEmployee({ regionId: region.id, lineId: bound });

    await employeeRepository.updateFromRagic(emp.id, { lineId: "not-a-line-id", phone: "0900000009" });

    expect(await lineIdOf(emp.id)).toBe(bound);
    expect((await employeeRepository.getEmployee(emp.id))!.phone).toBe("0900000009");
  });

  it("replaces an id that is not valid, and replaces a valid one with a valid one from Ragic", async () => {
    const region = await regionA();
    const emp = await createEmployee({ regionId: region.id, lineId: "old-text" });

    await employeeRepository.updateFromRagic(emp.id, { lineId: "other-text" });
    expect(await lineIdOf(emp.id)).toBe("other-text");

    await employeeRepository.updateFromRagic(emp.id, { lineId: bound });
    expect(await lineIdOf(emp.id)).toBe(bound);
    const next = "U" + "b".repeat(32);
    await employeeRepository.updateFromRagic(emp.id, { lineId: next });
    expect(await lineIdOf(emp.id)).toBe(next);
  });
});

describe("venue sync leaves other venues alone", () => {
  it("does not create a venue that already exists", async () => {
    const region = await regionA();
    await createVenue({ regionId: region.id, name: "新北高中", shortName: "新北高中" });
    ragic.fetch.mockResolvedValue(snapshot(record("E001", { 部門: ["新北高中"] })));

    const body = await (await post("/api/ragic/sync-venues")).json();

    expect([body.created, body.existing]).toEqual([0, 1]);
    expect(await db.select().from(venues)).toHaveLength(1);
  });
});
