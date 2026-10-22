/**
 * Portal workmates sub-routes — coworker discovery (today / 7-day window).
 * Endpoints:
 *   GET    /api/portal/upcoming-coworkers/:employeeId
 *   GET    /api/portal/workmates
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";
import { ok, fail, badRequest } from "../../shared/http/response";

function extractLineUserId(req: import("express").Request): string | undefined {
  return (req.header("x-line-user-id") as string | undefined) ??
    (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
}

export function mountPortalWorkmatesRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/upcoming-coworkers/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      if (!employeeId) return ok(res, []);
      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      ok(res, await portalService.getUpcomingCoworkers(employeeId));
    } catch (err: any) {
      fail(res, 500, err.message || "未知錯誤");
    }
  });

  app.get("/api/portal/workmates", async (req, res) => {
    try {
      const employeeId = parseInt(String(req.query.employeeId || ""));
      const date = String(req.query.date || "");
      if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return badRequest(res, "employeeId 與 date (YYYY-MM-DD) 為必填");
      }
      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      try {
        ok(res, await portalService.getWorkmates(employeeId, date));
      } catch (err: any) {
        const code = err.extra?.code ?? err.code;
        if (code) return fail(res, err.status || 400, err.message, { code });
        throw err;
      }
    } catch (err: any) {
      fail(res, err.status || 500, err.message || "未知錯誤");
    }
  });
}
