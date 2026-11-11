import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditActorSnapshot } from "@shared/operation-audit-schema";

export type AuditActor = AuditActorSnapshot;
const context = new AsyncLocalStorage<AuditActor>();

export function withAuditActor<T>(actor: AuditActor, fn: () => T): T {
  const snapshot: AuditActor = actor.kind === "personal" || actor.kind === "employee"
    ? { kind: actor.kind, employeeId: actor.employeeId, name: actor.name }
    : { kind: actor.kind };
  return context.run(snapshot, fn);
}

export function currentAuditActor(): AuditActor {
  return { ...(context.getStore() ?? { kind: "system" as const }) };
}

export function auditActorLabel(actor = currentAuditActor()): string {
  if (actor.kind === "personal" || actor.kind === "employee") return actor.employeeId === undefined
    ? `${actor.kind}:unattributed`
    : `${actor.kind}:${actor.employeeId}|${actor.name ?? ""}`;
  return actor.kind;
}
