import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditMutations, operationAudit } from "@shared/operation-audit-schema";
import { shiftAuditLog, systemConfigs } from "@shared/schema";
import { db, pool } from "../../infra/db";
import { createEmployee, createRegion, createShift, createVenue, resetDatabase } from "../../test/itest";
import { withAuditActor } from "../../shared/audit/actor";
import { adminRepository } from "../admin/admin.repository";
import { shiftRepository } from "../shift/shift.repository";
import { evaluateAuditActor } from "../../core/health/rules";
import { readAuditActorSignals } from "./health.service";

beforeAll(async () => { await pool.query(await readFile(new URL("../../../docs/sql/ws-f8f9-audit.sql", import.meta.url), "utf8")); });
beforeEach(() => resetDatabase());
const read = () => readAuditActorSignals(new Date(Date.now() + 100));
const level = async () => evaluateAuditActor({ id: "audit.actor", name: "操作紀錄", source: "audit_mutations", signals: await read() }).level;
async function world() {
  const region = await createRegion();
  const venue = await createVenue({ regionId: region.id });
  const employee = await createEmployee({ regionId: region.id });
  return { employeeId: employee.id, venueId: venue.id, date: "2026-11-11", startTime: "08:00", endTime: "12:00", role: "救生" };
}

it("reads an installed witness and an empty database as green", async () => {
  expect(await read()).toMatchObject({ witnessAvailable: true, missingAudits24h: 0, sharedWrites24h: 0 });
  expect(await level()).toBe("green");
});
it("finds an actual committed write that bypassed its repository, and does not accept a different transaction's log", async () => {
  const shift = await createShift(await world());
  const [witness] = await db.select().from(auditMutations);
  expect(witness.recordId).toBe(String(shift.id));
  expect((await read()).missingAudits24h).toBe(1);
  await db.insert(operationAudit).values({ entity: "shifts", recordId: witness.recordId, action: "create", actor: { kind: "system" }, mutationId: witness.id, transactionId: "different-transaction" });
  expect((await read()).missingAudits24h).toBe(1);
  expect(await level()).toBe("red");
});
it("matches the original shift audit only when both mutation id and transaction id match", async () => {
  const input = await world();
  await withAuditActor({ kind: "personal", employeeId: 123, name: "測試操作員" }, () => shiftRepository.createShift(input, "test"));
  expect((await read()).missingAudits24h).toBe(0);
  const [audit] = await db.select().from(shiftAuditLog);
  await db.update(shiftAuditLog).set({ payload: { ...(audit.payload as object), transactionId: "different-transaction" } }).where(eq(shiftAuditLog.id, audit.id));
  expect((await read()).missingAudits24h).toBe(1);
});
it("counts real shared writes, permits the disabling operation itself, and remembers a prohibited write after re-enabling", async () => {
  const input = await world();
  await withAuditActor({ kind: "shared_password" }, () => shiftRepository.createShift(input, "shared_password"));
  expect((await read()).sharedWrites24h).toBe(1);
  expect(await level()).toBe("yellow");
  await withAuditActor({ kind: "shared_password" }, () => adminRepository.saveSharedPasswordEnabled(false));
  expect((await read()).disabledSharedWrites24h).toBe(0);
  expect(await level()).toBe("green");
  await withAuditActor({ kind: "shared_password" }, () => shiftRepository.createShift({ ...input, date: "2026-11-12" }, "shared_password"));
  expect((await read()).disabledSharedWrites24h).toBe(1);
  await withAuditActor({ kind: "personal", employeeId: 123, name: "測試操作員" }, () => adminRepository.saveSharedPasswordEnabled(true));
  expect(await level()).toBe("red");
});
it.each(["UTC", "Asia/Taipei"])("uses the same exact 24-hour boundary with process TZ=%s", async zone => {
  const oldZone = process.env.TZ;
  process.env.TZ = zone;
  try {
    await createShift(await world());
    const fixedNow = new Date("2026-11-11T06:00:00Z");
    await db.update(auditMutations).set({ createdAt: new Date("2026-11-10T06:00:00Z") });
    expect((await readAuditActorSignals(fixedNow)).missingAudits24h).toBe(1);
    await db.update(auditMutations).set({ createdAt: new Date("2026-11-10T05:59:59.999Z") });
    expect((await readAuditActorSignals(fixedNow)).missingAudits24h).toBe(0);
  } finally { if (oldZone === undefined) delete process.env.TZ; else process.env.TZ = oldZone; }
});
it("reads an anonymous persisted audit failure as red", async () => {
  await db.insert(systemConfigs).values({ key: "audit.failure", value: JSON.stringify({ failed: true, at: new Date().toISOString(), reason: "audit_write_failed" }) });
  expect((await read()).failures24h).toBe(1);
  expect(await level()).toBe("red");
});
