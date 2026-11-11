import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminRolePermissions } from "@shared/admin-permissions";
import { operationAudit, auditMutations } from "@shared/operation-audit-schema";
import { systemConfigs } from "@shared/schema";
import { db, pool } from "../../infra/db";
import { concurrently, resetDatabase } from "../../test/itest";
import { withFailingWrites } from "../../test/failWrites";
import { withAuditActor } from "../../shared/audit/actor";
import { adminRepository, SHARED_PASSWORD_KEY } from "./admin.repository";
import { adminService } from "./admin.service";
import { systemService } from "../system/system.service";

beforeAll(async () => {
  // The integration harness proves loopback PostgreSQL before this test installs its isolated witness.
  await pool.query(await readFile(new URL("../../../docs/sql/ws-f8f9-audit.sql", import.meta.url), "utf8"));
});
beforeEach(() => resetDatabase());
const actor = { kind: "personal" as const, employeeId: 42, name: "管理者快照" };

describe("persisted role grants, shared switch, and personal-login registry", () => {
  it("defaults the three specified roles to full rights and other roles to no rights, then honors a saved empty override", async () => {
    for (const role of ["主管職", "行政專員", "資訊工程師"]) expect(await adminService.permissionsForRole(role)).toContain("permissions:write");
    expect(await adminService.permissionsForRole("救生")).toEqual([]);
    await withAuditActor(actor, () => adminRepository.saveRolePermissions("主管職", []));
    expect(await adminService.permissionsForRole("主管職")).toEqual([]);
  });

  it("writes actual before/after permissions and the matching database witness in the same transaction", async () => {
    await withAuditActor(actor, async () => {
      await adminRepository.saveRolePermissions("救生", ["employees:read"]);
      await adminRepository.saveRolePermissions("救生", ["employees:read", "employees:write"]);
    });
    const rows = await db.select().from(operationAudit).orderBy(operationAudit.id);
    const witnesses = await db.select().from(auditMutations).orderBy(auditMutations.id);
    expect(rows.map((row) => row.actor)).toEqual([actor, actor]);
    expect(rows[1].before).toMatchObject({ permissions: ["employees:read"] });
    expect(rows[1].after).toMatchObject({ permissions: ["employees:read", "employees:write"] });
    expect(rows.map((row) => row.mutationId)).toEqual(witnesses.map((row) => row.id));
    expect(rows.map((row) => row.transactionId)).toEqual(witnesses.map((row) => row.transactionId));
  });

  it("uses distinct login keys for two people and preserves first-login time on concurrent repeated logins", async () => {
    const person = { id: 7, name: "個人甲", role: "救生" };
    await withAuditActor(actor, () => adminRepository.recordPersonalLogin(person));
    const first = (await adminRepository.personalLogins())[0].firstLoginAt;
    await withAuditActor(actor, async () => {
      await Promise.all([
        ...Array.from({ length: 3 }, (_, i) => adminRepository.recordPersonalLogin({ ...person, name: `個人甲${i}` })),
        adminRepository.recordPersonalLogin({ id: 8, name: "個人乙", role: "行政專員" }),
      ]);
    });
    const logins = await adminRepository.personalLogins();
    expect(logins.map((row) => row.employeeId).sort()).toEqual([7, 8]);
    expect(logins.find((row) => row.employeeId === 7).firstLoginAt).toBe(first);
    expect((await db.select().from(systemConfigs)).map((row) => row.key).sort()).toEqual(["admin.personal-login:7", "admin.personal-login:8"]);
  });

  it("serializes two first role writes without inventing an obsolete before snapshot", async () => {
    const result = await withAuditActor(actor, () => concurrently(2, (i) => adminRepository.saveRolePermissions("救生", i ? ["employees:read"] : [])));
    expect(result.map((row) => row.status)).toEqual(["fulfilled", "fulfilled"]);
    const audit = await db.select().from(operationAudit).orderBy(operationAudit.id);
    expect(audit[0].before).toBeNull();
    expect(audit[1].before).toEqual(audit[0].after);
  });

  it("defaults shared login on, persists off, and prevents generic system-config APIs from changing auth state", async () => {
    expect(await adminRepository.sharedPasswordEnabled()).toBe(true);
    await withAuditActor(actor, () => adminRepository.saveSharedPasswordEnabled(false));
    expect(await adminRepository.sharedPasswordEnabled()).toBe(false);
    expect((await db.select().from(systemConfigs).where(eq(systemConfigs.key, SHARED_PASSWORD_KEY)))[0].value).toBe("false");
    for (const key of [SHARED_PASSWORD_KEY, "admin.personal-login:7"]) await expect(systemService.upsertSystemConfig(key, "true")).rejects.toMatchObject({ status: 400 });
  });

  it("rolls back a permission write and its witness if the required audit insert fails", async () => {
    await withFailingWrites("operation_audit", "insert", "true", async () => {
      await expect(withAuditActor(actor, () => adminRepository.saveRolePermissions("救生", ["employees:read"]))).rejects.toThrow();
    });
    expect(await db.select().from(adminRolePermissions)).toEqual([]);
    expect(await db.select().from(auditMutations)).toEqual([]);
    const [signal] = await db.select().from(systemConfigs).where(eq(systemConfigs.key, "audit.failure"));
    expect(JSON.parse(signal.value)).toMatchObject({ failed: true });
  });
});
