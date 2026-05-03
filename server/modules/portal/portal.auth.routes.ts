/**
 * Portal auth sub-routes — dev-login + LINE Login OAuth + lineId verification.
 * Endpoints:
 *   GET    /api/portal/dev-employees     (dev mode only)
 *   POST   /api/portal/dev-login          (dev mode only)
 *   POST   /api/portal/line-callback
 *   POST   /api/portal/verify
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";

export function mountPortalAuthRoutes(_httpServer: Server, app: Express): void {
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
}
