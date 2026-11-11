import type { Express } from "express";
import { z } from "zod";
import { requireAdmin } from "../../shared/middleware/requireAdmin";
import { auditService } from "./audit.service";

const querySchema = z.object({
  employeeId: z.coerce.number().int().positive().optional(),
  entity: z.enum(["shifts", "dispatch_shifts", "clock_records", "clock_amendments", "leave_requests", "employee_leave_balances", "system_configs", "admin_role_permissions"]).optional(),
  recordId: z.string().min(1).max(200).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
});

export function mountAuditRoutes(app: Express): void {
  app.get("/api/audit/timeline", requireAdmin, async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "時間軸查詢參數錯誤" });
    const { since, limit, cursor, ...filters } = parsed.data;
    const rows = await auditService.timeline({ ...filters, since: since ? new Date(since) : undefined, limit: limit + 1, cursor });
    res.set("Cache-Control", "no-store");
    res.json({ items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(cursor + limit) : null });
  });
}
