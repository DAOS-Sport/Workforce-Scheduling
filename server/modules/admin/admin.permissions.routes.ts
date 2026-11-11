import type { Express } from "express";
import { adminService } from "./admin.service";

export function mountAdminPermissionsRoutes(app: Express): void {
  app.get("/api/admin/permissions", async (_req, res) => {
    res.json(await adminService.permissionMatrix());
  });
  app.put("/api/admin/permissions/:role", async (req, res) => {
    try { res.json(await adminService.saveRolePermissions(String(req.params.role), req.body?.permissions)); }
    catch (err: any) { res.status(err.status || 500).json({ message: err.message }); }
  });
  app.get("/api/admin/personal-logins", async (_req, res) => res.json(await adminService.personalLogins()));
  app.get("/api/admin/shared-password", async (_req, res) => res.json({ enabled: await adminService.sharedPasswordEnabled() }));
  app.put("/api/admin/shared-password", async (req, res) => {
    try { res.json({ enabled: await adminService.saveSharedPasswordEnabled(req.body?.enabled) }); }
    catch (err: any) { res.status(err.status || 500).json({ message: err.message }); }
  });
}
