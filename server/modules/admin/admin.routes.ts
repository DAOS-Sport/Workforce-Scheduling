/**
 * Admin auth HTTP routes — extracted from server/routes.ts as part of
 * Task #69 server architecture refactor.
 *
 * These routes (login / me / logout / dev-login) bootstrap the admin
 * session cookie and therefore MUST be mounted BEFORE the gateAdminApi
 * middleware in the registry. They are intentionally kept in their own
 * module for clarity and so future SSO/OAuth changes have an obvious home.
 */
import type { Express } from "express";
import type { Server } from "http";
import { storage } from "../../storage";

export function mountAdminAuthRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { password } = req.body;
      if (!password) return res.status(400).json({ message: "請輸入密碼" });

      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
      if (!ADMIN_PASSWORD) return res.status(500).json({ message: "伺服器未設定管理員密碼" });
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "密碼錯誤" });
      }

      const allEmployees = await storage.getAllEmployees();
      const admin = allEmployees.find(e => e.isAdmin);

      req.session.adminId = admin?.id || 1;
      req.session.adminName = admin?.name || "管理員";
      req.session.adminLineId = "";

      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "登入儲存失敗" });
        }
        res.json({ id: req.session.adminId, name: req.session.adminName });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
    if (process.env.REPLIT_DEPLOYMENT === "1") {
      return res.status(403).json({ message: "此功能僅限開發環境使用" });
    }
    try {
      const allEmployees = await storage.getAllEmployees();
      const admin = allEmployees.find((e: any) => e.isAdmin);
      req.session.adminId = admin?.id || 1;
      req.session.adminName = admin?.name || "管理員";
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
