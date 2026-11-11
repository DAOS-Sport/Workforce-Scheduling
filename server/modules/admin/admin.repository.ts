import { eq, like, sql } from "drizzle-orm";
import { adminRolePermissions } from "@shared/admin-permissions";
import { systemConfigs } from "@shared/schema";
import { db } from "../../infra/db";
import { withTx } from "../../infra/db/tx";
import { recordOperation, withAuditFailureSignal, prepareAudit } from "../../shared/audit/recorder";

export const SHARED_PASSWORD_KEY = "admin.shared-password-enabled";
const LOGIN_PREFIX = "admin.personal-login:";

export const adminRepository = {
  async rolePermissions(role: string) {
    const [row] = await db.select().from(adminRolePermissions).where(eq(adminRolePermissions.role, role));
    return row;
  },
  listRolePermissions: () => db.select().from(adminRolePermissions),
  async sharedPasswordEnabled() {
    const [row] = await db.select().from(systemConfigs).where(eq(systemConfigs.key, SHARED_PASSWORD_KEY));
    return row ? row.value === "true" : true;
  },
  async saveRolePermissions(role: string, permissions: string[]) {
    return withAuditFailureSignal(() => withTx(async (tx) => {
      await prepareAudit(tx);
      // Serialize replacement and its before/after receipt on the role's stable key, including its first insert.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('admin-role-permissions'), hashtext(${role}))`);
      const [before] = await tx.select().from(adminRolePermissions).where(eq(adminRolePermissions.role, role));
      const [after] = await tx.insert(adminRolePermissions).values({ role, permissions, updatedAt: new Date() })
        .onConflictDoUpdate({ target: adminRolePermissions.role, set: { permissions, updatedAt: new Date() } }).returning();
      await recordOperation(tx, { entity: "admin_role_permissions", recordId: role, action: before ? "update" : "create", before: before ?? null, after });
      return after;
    }));
  },
  async saveSharedPasswordEnabled(enabled: boolean) {
    return withAuditFailureSignal(() => withTx(async (tx) => {
      await prepareAudit(tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('admin-setting'), hashtext(${SHARED_PASSWORD_KEY}))`);
      const [before] = await tx.select().from(systemConfigs).where(eq(systemConfigs.key, SHARED_PASSWORD_KEY));
      const [after] = await tx.insert(systemConfigs).values({ key: SHARED_PASSWORD_KEY, value: String(enabled), updatedAt: new Date() })
        .onConflictDoUpdate({ target: systemConfigs.key, set: { value: String(enabled), updatedAt: new Date() } }).returning();
      await recordOperation(tx, { entity: "system_configs", recordId: SHARED_PASSWORD_KEY, action: before ? "update" : "create", before: before ?? null, after });
      return enabled;
    }));
  },
  async recordPersonalLogin(employee: { id: number; name: string; role: string }) {
    return withAuditFailureSignal(() => withTx(async (tx) => {
      await prepareAudit(tx);
      const key = `${LOGIN_PREFIX}${employee.id}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('admin-personal-login'), ${employee.id})`);
      const [before] = await tx.select().from(systemConfigs).where(eq(systemConfigs.key, key));
      const previous = before ? JSON.parse(before.value) : null;
      const now = new Date().toISOString();
      const value = JSON.stringify({ employeeId: employee.id, name: employee.name, role: employee.role, firstLoginAt: previous?.firstLoginAt ?? now, lastLoginAt: now });
      const [after] = await tx.insert(systemConfigs).values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: systemConfigs.key, set: { value, updatedAt: new Date() } }).returning();
      await recordOperation(tx, { entity: "system_configs", recordId: key, action: before ? "update" : "create", before: before ?? null, after, employeeId: employee.id });
    }));
  },
  async personalLogins() {
    const rows = await db.select().from(systemConfigs).where(like(systemConfigs.key, `${LOGIN_PREFIX}%`));
    return rows.map((row) => JSON.parse(row.value)).sort((a, b) => String(b.lastLoginAt).localeCompare(String(a.lastLoginAt)));
  },
};
