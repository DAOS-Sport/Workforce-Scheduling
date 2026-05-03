/**
 * Portal guidelines sub-routes — relevant guideline list + ack workflow.
 * Endpoints:
 *   GET    /api/portal/guidelines-check/:employeeId
 *   GET    /api/portal/guidelines/:id
 *   POST   /api/portal/acknowledge-all
 *
 * All employee-facing endpoints verify caller identity (Task #56).
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

export function mountPortalGuidelinesRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/guidelines-check/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      ok(res, await portalService.guidelinesCheck(employeeId));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/portal/guidelines/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const employeeId = parseInt(req.query.employeeId as string);
      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      ok(res, await portalService.getGuideline(id, employeeId));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/portal/acknowledge-all", async (req, res) => {
    try {
      const { employeeId, guidelineIds } = req.body;
      const auth = await portalService.verifyCaller(parseInt(employeeId), extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      ok(res, await portalService.acknowledgeAll(employeeId, guidelineIds));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
