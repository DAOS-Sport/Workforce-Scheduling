/**
 * Portal workmates sub-routes — coworker discovery (today / 7-day window).
 * Endpoints:
 *   GET    /api/portal/upcoming-coworkers/:employeeId
 *   GET    /api/portal/workmates
 *   GET    /api/portal/today-coworkers/:employeeId   (deprecated)
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";

export function mountPortalWorkmatesRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/upcoming-coworkers/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      if (!employeeId) return res.json([]);
      const lineUserId =
        (req.header("x-line-user-id") as string | undefined) ??
        (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
      const auth = await portalService.verifyCaller(employeeId, lineUserId);
      if (!auth.ok) return res.status(auth.status).json({ code: auth.code, message: auth.message });
      res.json(await portalService.getUpcomingCoworkers(employeeId));
    } catch (err: any) {
      res.status(500).json({ message: err.message || "未知錯誤" });
    }
  });

  app.get("/api/portal/workmates", async (req, res) => {
    try {
      const employeeId = parseInt(String(req.query.employeeId || ""));
      const date = String(req.query.date || "");
      if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "employeeId 與 date (YYYY-MM-DD) 為必填" });
      }
      const lineUserId =
        (req.header("x-line-user-id") as string | undefined) ??
        (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
      const auth = await portalService.verifyCaller(employeeId, lineUserId);
      if (!auth.ok) return res.status(auth.status).json({ code: auth.code, message: auth.message });
      try {
        res.json(await portalService.getWorkmates(employeeId, date));
      } catch (err: any) {
        if (err.code) return res.status(err.status || 400).json({ code: err.code, message: err.message });
        throw err;
      }
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message || "未知錯誤" });
    }
  });

  app.get("/api/portal/today-coworkers/:employeeId", async (req, res) => {
    res.setHeader("Deprecation", "true");
    res.setHeader("Link", '</api/portal/workmates>; rel="successor-version"');
    try {
      const employeeId = parseInt(req.params.employeeId);
      if (!employeeId) return res.json([]);
      const lineUserId =
        (req.header("x-line-user-id") as string | undefined) ??
        (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
      const auth = await portalService.verifyCaller(employeeId, lineUserId);
      if (!auth.ok) return res.status(auth.status).json({ code: auth.code, message: auth.message });
      res.json(await portalService.getTodayCoworkers(employeeId));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
