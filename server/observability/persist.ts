/**
 * server/observability/persist.ts
 *
 * Async DB persistence for warn/error/audit log entries.
 * Registered with the logger during bootstrap so the logger itself
 * never imports DB (avoids circular dependency).
 */
import { db } from "../infra/db";
import { appLogs, auditLogs } from "@shared/schema";
import { registerPersistFn, type LogEntry } from "../shared/log";

export function registerLogPersistence() {
  registerPersistFn(async (entry: LogEntry) => {
    try {
      if (entry.level === "audit") {
        const ctx = (entry.safe_context ?? {}) as Record<string, unknown>;
        const auditFields = (ctx.audit ?? {}) as Record<string, unknown>;
        await db.insert(auditLogs).values({
          requestId: entry.request_id ?? null,
          actorUserId: auditFields.actor_user_id != null ? String(auditFields.actor_user_id) : null,
          actorRole: typeof auditFields.actor_role === "string" ? auditFields.actor_role : null,
          action: typeof auditFields.action === "string" ? auditFields.action : entry.action ?? "unknown",
          targetType: typeof auditFields.target_type === "string" ? auditFields.target_type : null,
          targetId: auditFields.target_id != null ? String(auditFields.target_id) : null,
          beforeState: auditFields.before_state ?? null,
          afterState: auditFields.after_state ?? null,
          message: entry.message,
        });
      } else {
        await db.insert(appLogs).values({
          level: entry.level,
          service: entry.service,
          environment: entry.environment,
          module: entry.module ?? null,
          action: entry.action ?? null,
          requestId: entry.request_id ?? null,
          route: entry.route ?? null,
          method: entry.method ?? null,
          statusCode: entry.status_code ?? null,
          durationMs: entry.duration_ms ?? null,
          errorCode: entry.error_code ?? null,
          errorMessage: entry.error_message ?? null,
          externalService: entry.external_service ?? null,
          safeContext: entry.safe_context ?? null,
          message: entry.message,
        });
      }
    } catch {
    }
  });
}
