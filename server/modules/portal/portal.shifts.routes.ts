/**
 * Portal shifts sub-routes — employee's own schedule + certificate upload.
 * Endpoints:
 *   GET    /api/portal/my-shifts/:employeeId/:startDate/:endDate
 *   PATCH  /api/portal/shifts/:shiftId/certificate
 *
 * Employee-facing endpoints verify caller identity (Task #56).
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

export function mountPortalShiftsRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/my-shifts/:employeeId/:startDate/:endDate", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      const { startDate, endDate } = req.params;
      ok(res, await portalService.getMyShifts(employeeId, startDate, endDate));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.patch("/api/portal/shifts/:shiftId/certificate", async (req, res) => {
    try {
      const shiftId = parseInt(req.params.shiftId);
      const { employeeId, certificateImageUrl } = req.body;
      const auth = await portalService.verifyCaller(parseInt(employeeId), extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      const actor = req.session.adminName || "admin:certificate";
      ok(res, await portalService.updateShiftCertificate(shiftId, parseInt(employeeId), certificateImageUrl, actor));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
