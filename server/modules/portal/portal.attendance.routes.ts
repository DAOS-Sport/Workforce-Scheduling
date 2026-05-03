/**
 * Portal attendance sub-routes — employee's monthly attendance summary.
 * Endpoints:
 *   GET    /api/portal/my-attendance/:employeeId
 *
 * Verifies caller identity (Task #56).
 * Uses uniform response helpers (Task #79).
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";
import { ok, fail } from "../../shared/http/response";

function extractLineUserId(req: import("express").Request): string | undefined {
  return (req.header("x-line-user-id") as string | undefined) ??
    (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
}

export function mountPortalAttendanceRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/my-attendance/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      ok(res, await portalService.getMyAttendance(employeeId));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
