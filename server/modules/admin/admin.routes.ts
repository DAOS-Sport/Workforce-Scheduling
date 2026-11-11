import type { Express, Request } from "express";
import type { Server } from "http";
import { randomBytes } from "node:crypto";
import { adminService, type AdminIdentity } from "./admin.service";
import { withAuditActor } from "../../shared/audit/actor";

async function saveSession(req: Request) {
  await new Promise<void>((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()));
}
async function establishSession(req: Request, identity: AdminIdentity, lineId = "") {
  await new Promise<void>((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
  req.session.adminId = identity.id;
  req.session.adminName = identity.name;
  req.session.adminLineId = lineId;
  req.session.adminAuthKind = identity.authKind;
  await saveSession(req);
}

export function mountAdminAuthRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/admin/login-options", async (_req, res) => {
    try { res.json(await adminService.loginOptions()); }
    catch { res.status(503).json({ message: "無法讀取登入設定" }); }
  });
  app.post("/api/admin/login", async (req, res) => {
    try {
      const identity = await adminService.authenticate(req.body?.password);
      await establishSession(req, identity);
      res.json(identity);
    } catch (err: any) { res.status(err.status || 500).json({ message: err.message }); }
  });
  app.get("/api/admin/line-login", async (req, res) => {
    try {
      const state = randomBytes(32).toString("hex");
      const redirectUri = `${req.protocol}://${req.get("host")}/admin/line-callback`;
      const url = adminService.lineAuthorizationUrl(state, redirectUri);
      req.session.adminOAuthState = state;
      req.session.adminOAuthRedirectUri = redirectUri;
      await saveSession(req);
      res.json({ url });
    } catch (err: any) { res.status(err.status || 500).json({ message: err.status ? err.message : "無法建立 LINE 登入" }); }
  });
  app.post("/api/admin/line-callback", async (req, res) => {
    try {
      const { code, state } = req.body ?? {};
      const expectedState = req.session.adminOAuthState;
      const redirectUri = req.session.adminOAuthRedirectUri;
      delete req.session.adminOAuthState;
      delete req.session.adminOAuthRedirectUri;
      await saveSession(req);
      if (!expectedState || state !== expectedState || !redirectUri) return res.status(400).json({ message: "LINE 登入狀態已失效，請重新登入" });
      const identity = await adminService.authenticateLine(code, redirectUri);
      await establishSession(req, identity, identity.lineId);
      try {
        await withAuditActor({ kind: "personal", employeeId: identity.id, name: identity.name }, () => adminService.recordPersonalLogin({ id: identity.id, name: identity.name, role: identity.role }));
      } catch (err) {
        await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
        throw err;
      }
      res.json({ id: identity.id, name: identity.name, role: identity.role, authKind: identity.authKind, permissions: identity.permissions });
    } catch (err: any) { res.status(err.status || 500).json({ message: err.message }); }
  });
  app.get("/api/admin/me", async (req, res) => {
    try { res.json(await adminService.resolveSession(req.session)); }
    catch (err: any) { res.status(err.status || 500).json({ message: err.message }); }
  });
  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });
  app.post("/api/admin/dev-login", async (req, res) => {
    if (adminService.isProductionDeployment()) return res.status(403).json({ message: "此功能僅限開發環境使用" });
    try {
      const identity = await adminService.resolveAdminIdentity();
      await establishSession(req, identity);
      res.json(identity);
    } catch (err: any) { res.status(err.status || 500).json({ message: err.message }); }
  });
}
