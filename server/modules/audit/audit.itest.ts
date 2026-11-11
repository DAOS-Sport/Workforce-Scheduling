import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clockAmendments, clockRecords, employeeLeaveBalances, leaveRequests, shiftAuditLog, systemConfigs } from "@shared/schema";
import { operationAudit, auditMutations } from "@shared/operation-audit-schema";
import { db, pool } from "../../infra/db";
import { withTx } from "../../infra/db/tx";
import { createEmployee, createRegion, createVenue, resetDatabase } from "../../test/itest";
import { withFailingWrites } from "../../test/failWrites";
import { withAuditActor } from "../../shared/audit/actor";
import { clockService } from "../clock/clock.service";
import { clockRepository } from "../clock/clock.repository";
import { leaveService } from "../leave/leave.service";
import { shiftRepository } from "../shift/shift.repository";
import { auditRepository } from "./audit.repository";
import { portalService } from "../portal/portal.service";
import { adminService } from "../admin/admin.service";
import { readAuditActorSignals } from "../health/health.service";
import { evaluateAuditActor } from "../../core/health/rules";

beforeAll(async () => {
  await pool.query(await readFile(new URL("../../../docs/sql/ws-f8f9-audit.sql", import.meta.url), "utf8"));
});
beforeEach(() => resetDatabase());
afterEach(() => vi.restoreAllMocks());

async function world() {
  const region = await createRegion();
  const employee = await createEmployee({ regionId: region.id });
  const venue = await createVenue({ regionId: region.id });
  return { employee, venue };
}
const personal = { kind: "personal" as const, employeeId: 42, name: "當下管理員" };
const clock = (employeeId: number, venueId: number) => ({ employeeId, venueId, clockType: "in", clockTime: "2026-11-10T00:00:00Z" });

describe("committed database mutations and audit rows", () => {
  it("does not audit or witness ordinary punch and leave request inserts", async () => {
    const { employee, venue } = await world();
    await clockRepository.createClockRecord({ ...clock(employee.id, venue.id), clockTime: new Date("2026-11-10T00:00:00Z"), latitude: 25, longitude: 121 });
    await leaveService.submit({ employeeId: employee.id, leaveType: "事假", startDate: "2026-11-10", endDate: "2026-11-10" });
    expect(await db.select().from(operationAudit)).toEqual([]);
    expect(await db.select().from(auditMutations)).toEqual([]);
  });

  it("preserves the actor snapshot and actual DB mutation link for shift writes", async () => {
    const { employee, venue } = await world();
    await withAuditActor(personal, () => shiftRepository.createShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-10", startTime: "08:00", endTime: "12:00", role: "救生" }));
    const [audit] = await db.select().from(shiftAuditLog);
    const [witness] = await db.select().from(auditMutations);
    expect(audit.payload).toMatchObject({ actor: personal, mutationId: witness.id, transactionId: witness.transactionId });
    expect(witness).toMatchObject({ tableName: "shifts", operation: "INSERT", before: null });
  });

  it("admin add/edit/delete all audit, with a deletion tombstone", async () => {
    const { employee, venue } = await world();
    await withAuditActor(personal, async () => {
      const row = await clockService.adminCreateRecord(clock(employee.id, venue.id));
      await clockService.adminUpdateRecord(row.id, { clockTime: "2026-11-10T00:30:00Z" });
      await clockService.adminDeleteRecord(row.id);
    });
    const rows = await db.select().from(operationAudit).orderBy(operationAudit.id);
    expect(rows.map((r) => [r.action, r.actor])).toEqual([["create", personal], ["update", personal], ["delete", personal]]);
    expect(rows[2].before).toMatchObject({ employeeId: employee.id });
    expect(rows[2].after).toBeNull();
    expect((await db.select().from(auditMutations)).map((r) => r.operation)).toEqual(["INSERT", "UPDATE", "DELETE"]);
  });

  it("an audit failure rolls back the data and witness, and leaves an anonymous failure signal", async () => {
    const { employee, venue } = await world();
    await withFailingWrites("operation_audit", "insert", "true", async () => {
      await expect(withAuditActor(personal, () => clockService.adminCreateRecord(clock(employee.id, venue.id)))).rejects.toThrow();
    });
    expect(await db.select().from(clockRecords)).toEqual([]);
    expect(await db.select().from(auditMutations)).toEqual([]);
    const result = await db.execute(sql`select value from system_configs where key = 'audit.failure'`);
    expect(JSON.parse(String(result.rows[0]?.value))).toMatchObject({ failed: true });
    expect(JSON.stringify(result.rows)).not.toContain(personal.name);
  });

  it("captures direct UPDATE and DELETE without pretending an audit exists", async () => {
    const { employee, venue } = await world();
    const record = await clockRepository.createClockRecord({ ...clock(employee.id, venue.id), clockTime: new Date("2026-11-10T00:00:00Z"), latitude: 25, longitude: 121 });
    await db.update(clockRecords).set({ clockType: "out" }).where(eq(clockRecords.id, record.id));
    await db.delete(clockRecords).where(eq(clockRecords.id, record.id));
    expect(await db.select().from(operationAudit)).toHaveLength(0);
    const witnesses = await db.select().from(auditMutations).orderBy(auditMutations.id);
    expect(witnesses.map((w) => [w.operation, w.recordId])).toEqual([["UPDATE", String(record.id)], ["DELETE", String(record.id)]]);
    expect(witnesses[1].before).toMatchObject({ id: record.id });
    await db.insert(clockRecords).values({ ...clock(employee.id, venue.id), clockTime: new Date("2026-11-10T00:00:00Z"), latitude: 0, longitude: 0 });
    expect((await db.select().from(auditMutations).orderBy(auditMutations.id)).map((r) => r.operation)).toEqual(["UPDATE", "DELETE", "INSERT"]);
  });

  it("approves, adjusts and revokes annual leave with its balance in the same audit transaction", async () => {
    const { employee } = await world();
    await leaveService.adjustBalance(employee.id, 2026, 40, 42, personal.name);
    const request = await leaveService.submit({ employeeId: employee.id, leaveType: "特休", startDate: "2026-11-10", endDate: "2026-11-10" });
    await withAuditActor(personal, async () => {
      await leaveService.review(request.id, "approved", "核准", 42, personal.name);
      await leaveService.adjustRequest(request.id, { startTime: "08:00", endTime: "12:00" });
      await leaveService.revoke(request.id, "撤銷測試");
    });
    const [balance] = await db.select().from(employeeLeaveBalances);
    expect([balance.usedHours, balance.pendingHours]).toEqual([0, 0]);
    const [result] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, request.id));
    expect(result.status).toBe("cancelled");
    const audit = await db.select().from(operationAudit).where(eq(operationAudit.entity, "leave_requests")).orderBy(operationAudit.id);
    expect(audit.map((r) => r.action)).toEqual(["approve", "adjust", "revoke"]);
  });

  it("amendment approval writes review and clock audit together; audit failure leaves pending", async () => {
    const { employee, venue } = await world();
    const [request] = await db.insert(clockAmendments).values({ employeeId: employee.id, venueId: venue.id, clockType: "in", requestedTime: new Date("2026-11-10T00:00:00Z"), reason: "補打卡" }).returning();
    await withFailingWrites("operation_audit", "insert", "NEW.entity = 'clock_records'", async () => {
      await expect(withAuditActor(personal, () => clockService.approveAmendment(request.id, "approved", undefined, 42, personal.name))).rejects.toThrow();
    });
    expect((await db.select().from(clockAmendments))[0].status).toBe("pending");
    expect(await db.select().from(clockRecords)).toEqual([]);
    const failure = await db.execute(sql`select value from system_configs where key = 'audit.failure'`);
    expect(JSON.parse(String(failure.rows[0]?.value))).toMatchObject({ failed: true, reason: "audit_write_failed" });
    await withAuditActor({ kind: "shared_password" }, () => clockService.approveAmendment(request.id, "approved", undefined, 0, "共用密碼"));
    const rows = await db.select().from(operationAudit);
    expect(rows.map((r) => r.entity).sort()).toEqual(["clock_amendments", "clock_records"]);
    expect(rows.every((r) => r.actor.kind === "shared_password")).toBe(true);
  });

  it("timeline includes original employee submissions and later audit without duplicating originals", async () => {
    const { employee, venue } = await world();
    await clockRepository.createClockRecord({ ...clock(employee.id, venue.id), clockTime: new Date("2026-11-10T00:00:00Z"), latitude: 25, longitude: 121 });
    const request = await leaveService.submit({ employeeId: employee.id, leaveType: "事假", startDate: "2026-11-10", endDate: "2026-11-10" });
    await withAuditActor(personal, () => leaveService.review(request.id, "approved", undefined, 42, personal.name));
    const timeline = await auditRepository.timeline({ employeeId: employee.id });
    expect(timeline.filter((r) => r.source === "original")).toHaveLength(2);
    expect(timeline.some((r) => r.action === "approve" && r.actor.kind === "personal")).toBe(true);
    expect(timeline.find((r) => r.source === "original" && r.entity === "leave_requests")?.after).toMatchObject({ status: "pending" });
  });

  it("leave adjustment and revocation roll their earlier balance writes back when audit fails", async () => {
    const { employee } = await world();
    await leaveService.adjustBalance(employee.id, 2026, 40, 42, personal.name);
    const request = await leaveService.submit({ employeeId: employee.id, leaveType: "特休", startDate: "2026-11-10", endDate: "2026-11-10" });
    await withAuditActor(personal, () => leaveService.review(request.id, "approved", undefined, 42, personal.name));
    await withFailingWrites("operation_audit", "insert", "NEW.entity = 'leave_requests'", async () => {
      await expect(leaveService.adjustRequest(request.id, { startTime: "08:00", endTime: "12:00" })).rejects.toThrow();
      await expect(leaveService.revoke(request.id)).rejects.toThrow();
    });
    const [balance] = await db.select().from(employeeLeaveBalances);
    const [row] = await db.select().from(leaveRequests);
    expect([balance.usedHours, balance.pendingHours, row.status, row.hours]).toEqual([8, 0, "approved", 8]);
    const audit = await db.select().from(operationAudit).where(eq(operationAudit.entity, "leave_requests"));
    expect(audit.map((r) => r.action)).toEqual(["approve"]);
  });

  it("portal certificate writes use the matched employee snapshot and background writes remain system", async () => {
    const { employee, venue } = await world();
    const shift = await shiftRepository.createShift({ employeeId: employee.id, venueId: venue.id, date: "2026-11-10", startTime: "08:00", endTime: "12:00", role: "救生" });
    await portalService.updateShiftCertificate(shift.id, employee.id, "https://example.invalid/cert.png", "admin:certificate");
    const rows = await db.select().from(shiftAuditLog).orderBy(shiftAuditLog.id);
    expect(rows[0].payload).toMatchObject({ actor: { kind: "system" } });
    expect(rows[1].payload).toMatchObject({ actor: { kind: "employee", employeeId: employee.id, name: employee.name } });
    const witnesses = await db.select().from(auditMutations).orderBy(auditMutations.id);
    expect(witnesses.map((r) => r.actor.kind)).toEqual(["system", "employee"]);
  });

  it("timeline filters use AND and paginated results retain every change including a deleted original", async () => {
    const { employee, venue } = await world();
    const original = await clockRepository.createClockRecord({ ...clock(employee.id, venue.id), clockTime: new Date("2026-11-10T00:00:00Z"), latitude: 25, longitude: 121 });
    await withAuditActor(personal, async () => {
      await clockService.adminUpdateRecord(original.id, { clockTime: "2026-11-10T00:30:00Z" });
      await clockService.adminDeleteRecord(original.id);
    });
    const options = { employeeId: employee.id, entity: "clock_records", recordId: String(original.id), limit: 1 };
    const pages = await Promise.all([0, 1, 2].map((cursor) => auditRepository.timeline({ ...options, cursor })));
    expect(pages.flat().map((r) => r.action)).toEqual(["delete", "update", "submit"]);
    expect(new Set(pages.flat().map((r) => r.id)).size).toBe(3);
    expect(await auditRepository.timeline({ ...options, employeeId: employee.id + 1 })).toEqual([]);
  });

  it("an existing original punch keeps its original time and payload after admin editing", async () => {
    const { employee, venue } = await world();
    const original = await clockRepository.createClockRecord({ ...clock(employee.id, venue.id), clockTime: new Date("2026-11-10T00:00:00Z"), latitude: 25, longitude: 121 });
    const before = (await auditRepository.timeline({ employeeId: employee.id })).find((r) => r.source === "original")!;
    await withAuditActor(personal, () => clockService.adminUpdateRecord(original.id, { clockTime: "2026-11-10T00:30:00Z" }));
    const after = (await auditRepository.timeline({ employeeId: employee.id })).find((r) => r.source === "original")!;
    expect(after.at).toBe(before.at);
    expect(after.after).toMatchObject({ id: original.id, clockTime: "2026-11-10T00:00:00.000Z" });
  });

  it("a reassigned and deleted punch retains the original employee on the submission event", async () => {
    const { employee, venue } = await world();
    const nextEmployee = await createEmployee({ regionId: employee.regionId });
    const original = await clockRepository.createClockRecord({ ...clock(employee.id, venue.id), clockTime: new Date("2026-11-10T00:00:00Z"), latitude: 25, longitude: 121 });
    await withAuditActor(personal, async () => {
      await clockService.adminUpdateRecord(original.id, { employeeId: nextEmployee.id });
      await clockService.adminDeleteRecord(original.id);
    });
    const items = await auditRepository.timeline({ entity: "clock_records", recordId: String(original.id) });
    const submission = items.find((r) => r.source === "original")!;
    expect(submission.employeeId).toBe(employee.id);
    expect(submission.actor.employeeId).toBe(employee.id);
    expect(submission.after).toMatchObject({ employeeId: employee.id });
    expect((await auditRepository.timeline({ employeeId: employee.id, entity: "clock_records", recordId: String(original.id) })).some((r) => r.id === submission.id)).toBe(true);
  });

  it("audit times retain their UTC instant when the DB session uses Asia/Taipei", async () => {
    const { employee, venue } = await world();
    const started = Date.now();
    await withTx(async (tx) => {
      await tx.execute(sql`set local timezone = 'Asia/Taipei'`);
      await clockRepository.createManualClockRecord({ employeeId: employee.id, venueId: venue.id, clockType: "in", clockTime: new Date("2026-11-10T00:00:00Z"), latitude: 0, longitude: 0 }, tx);
    });
    const [item] = await auditRepository.timeline({ employeeId: employee.id });
    expect(item.at.endsWith("Z")).toBe(true);
    expect(new Date(item.at).getTime()).toBeGreaterThanOrEqual(started);
    expect(new Date(item.at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a noncanonical shared-password flag fails closed in auth and is recorded as disabled in DB evidence", async () => {
    const { employee, venue } = await world();
    await db.insert(systemConfigs).values({ key: "admin.shared-password-enabled", value: "0" });
    await expect(adminService.resolveAdminIdentity()).rejects.toMatchObject({ status: 401 });
    await withAuditActor({ kind: "shared_password" }, () => clockService.adminCreateRecord(clock(employee.id, venue.id)));
    const [witness] = await db.select().from(auditMutations).where(eq(auditMutations.tableName, "clock_records"));
    expect(witness.sharedPasswordEnabled).toBe(false);
    const signals = await readAuditActorSignals(new Date());
    expect(signals.disabledSharedWrites24h).toBe(1);
    expect(evaluateAuditActor({ id: "audit.actor", name: "操作人", signals }).level).toBe("red");
  });
});
