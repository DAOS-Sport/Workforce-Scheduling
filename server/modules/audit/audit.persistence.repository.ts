import { and, desc, eq, sql } from "drizzle-orm";
import { auditMutations, operationAudit } from "@shared/operation-audit-schema";
import { systemConfigs } from "@shared/schema";
import { db } from "../../infra/db";
import type { Executor } from "../../infra/db/tx";
import { currentAuditActor } from "../../shared/audit/actor";

const auditErrors = new WeakSet<object>();

export async function insertAudit<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err && typeof err === "object") auditErrors.add(err);
    throw err;
  }
}

/** Run outside the transaction that is allowed to roll back. The original error always escapes. */
export async function withAuditFailureSignal<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err && typeof err === "object" && auditErrors.has(err)) {
      try {
        const now = new Date();
        const value = JSON.stringify({ failed: true, at: now.toISOString(), reason: "audit_write_failed" });
        await db.insert(systemConfigs).values({ key: "audit.failure", value, updatedAt: now })
          .onConflictDoUpdate({ target: systemConfigs.key, set: { value, updatedAt: now } });
      } catch {
        // A database outage is reported by the database health signal; it cannot replace the original failure.
      }
    }
    throw err;
  }
}

export async function prepareAudit(tx: Executor, manualClockInsert = false): Promise<void> {
  await tx.execute(sql`select set_config('app.audit_actor', ${JSON.stringify(currentAuditActor())}, true)`);
  if (manualClockInsert) await tx.execute(sql`select set_config('app.audit_clock_insert', '1', true)`);
}

export async function mutationLink(tx: Executor, entity: string, recordId: string | number) {
  const result = await tx.execute(sql`select txid_current()::text as transaction_id`);
  const transactionId = String(result.rows[0].transaction_id);
  const [witness] = await tx.select({ id: auditMutations.id }).from(auditMutations)
    .where(and(eq(auditMutations.tableName, entity), eq(auditMutations.recordId, String(recordId)), eq(auditMutations.transactionId, transactionId)))
    .orderBy(desc(auditMutations.id)).limit(1);
  return { mutationId: witness?.id ?? null, transactionId };
}

export async function recordOperation(tx: Executor, data: {
  entity: string;
  recordId: string | number;
  employeeId?: number | null;
  action: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await insertAudit(async () => {
    const link = await mutationLink(tx, data.entity, data.recordId);
    await tx.insert(operationAudit).values({
      ...data, recordId: String(data.recordId), before: data.before ?? null, after: data.after ?? null,
      actor: currentAuditActor(), ...link, createdAt: sql`timezone('UTC',clock_timestamp())`,
    });
  });
}

export function auditedAtomic<T>(executor: Executor, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return withAuditFailureSignal(() => executor.transaction((tx) => fn(tx)));
}
