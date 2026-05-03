/**
 * Admin auth HTTP routes — the password / identity check itself lives in
 * admin.service.ts; this file only handles HTTP framing and the
 * req.session lifecycle (which can't move into the service because it
 * depends on Express request state and uses a callback API).
 */
import type { Express } from "express";
import type { Server } from "http";
import { adminService } from "./admin.service";

export function mountAdminAuthRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/admin/login", async (req, res) => {
    try {
      const identity = await adminService.authenticate(req.body?.password);
      req.session.adminId = identity.id;
      req.session.adminName = identity.name;
      req.session.adminLineId = "";
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "登入儲存失敗" });
        }
        res.json({ id: req.session.adminId, name: req.session.adminName });
      });
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/admin/me", (req, res) => {
    if (req.session.adminId) {
      res.json({ id: req.session.adminId, name: req.session.adminName });
    } else {
      res.status(401).json({ message: "未登入" });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.post("/api/admin/dev-login", async (req, res) => {
    if (adminService.isProductionDeployment()) {
      return res.status(403).json({ message: "此功能僅限開發環境使用" });
    }
    try {
      const identity = await adminService.resolveAdminIdentity();
      req.session.adminId = identity.id;
      req.session.adminName = identity.name;
      req.session.adminLineId = "";
      req.session.save((err) => {
        if (err) return res.status(500).json({ message: "登入失敗" });
        res.json({ id: req.session.adminId, name: req.session.adminName });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
