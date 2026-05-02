/**
 * Shift audit-log service.
 *
 * Today the audit-log row is written inline by storage.createShift /
 * updateShift / deleteShift / restoreShift; that's where the Task #50
 * protection lives. This service exposes the *read* surface and a stable
 * actor-string formatter so route handlers all log the same way.
 */
import { shiftRepository } from "./shift.repository";

/**
 * Build the canonical actor string used as `actor` in shiftAuditLog.
 *
 * Examples:
 *   formatActor("admin", "single-edit")   → "admin"
 *   formatActor("admin", "batch")         → "system:batch|by:admin"
 *   formatActor("admin", "import-batch")  → "system:import-batch|by:admin"
 *   formatActor("admin", "batch-update")  → "system:batch-update|by:admin"
 *   formatActor("admin", "copy-prev")     → "system:copy-prev|by:admin"
 */
export function formatActor(adminName: string | undefined, source: string): string {
  const who = adminName || "admin";
  if (source === "single-edit") return who;
  return `system:${source}|by:${who}`;
}

export const shiftAuditService = {
  formatActor,
  getAuditLog: shiftRepository.getShiftAuditLog,
};
