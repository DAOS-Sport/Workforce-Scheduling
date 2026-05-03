import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";

export function mountPortalRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/dev-employees", async (_req, res) => {
    if (!portalService.isDevMode) return res.status(404).json({ message: "Not found" });
    try { res.json(await portalService.devListEmployees()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/portal/dev-login", async (req, res) => {
    if (!portalService.isDevMode) return res.status(404).json({ message: "Not found" });
    try {
      res.json(await portalService.devLogin(req.body?.employeeId));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.post("/api/portal/line-callback", async (req, res) => {
    try {
      res.json(await portalService.lineCallback(req.body?.code, req.body?.redirectUri));
    } catch (err: any) {
      console.error("LINE callback error:", err);
      if (err.payload) {
        return res.status(err.status || 404).json({ message: err.message, ...err.payload });
      }
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.post("/api/portal/verify", async (req, res) => {
    try {
      res.json(await portalService.verify(req.body?.lineId));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/portal/my-shifts/:employeeId/:startDate/:endDate", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const { startDate, endDate } = req.params;
      res.json(await portalService.getMyShifts(employeeId, startDate, endDate));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/portal/shifts/:shiftId/certificate", async (req, res) => {
    try {
      const shiftId = parseInt(req.params.shiftId);
      const { employeeId, certificateImageUrl } = req.body;
      const actor = req.session.adminName || "admin:certificate";
      res.json(await portalService.updateShiftCertificate(shiftId, parseInt(employeeId), certificateImageUrl, actor));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

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

  app.get("/api/portal/guidelines-check/:employeeId", async (req, res) => {
    try {
      res.json(await portalService.guidelinesCheck(parseInt(req.params.employeeId)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/guidelines/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const employeeId = parseInt(req.query.employeeId as string);
      res.json(await portalService.getGuideline(id, employeeId));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.post("/api/portal/acknowledge-all", async (req, res) => {
    try {
      const { employeeId, guidelineIds } = req.body;
      res.json(await portalService.acknowledgeAll(employeeId, guidelineIds));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/portal/my-attendance/:employeeId", async (req, res) => {
    try {
      res.json(await portalService.getMyAttendance(parseInt(req.params.employeeId)));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
