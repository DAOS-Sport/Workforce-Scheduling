import type { Request, Response, NextFunction } from "express";
import { OPEN_API_PATHS, OPEN_API_PREFIXES } from "../../config/openApiPrefixes";
import { canonicalAdminPath, hasPermission } from "@shared/admin-permissions";
import { allowsAdminRequest } from "../../modules/admin/admin.policy";
import { withAuditActor } from "../audit/actor";

/**
 * Single source of truth for the admin-cookie guard used across every
 * /api/* route except those listed in OPEN_API_PREFIXES.
 *
 * Used in two ways:
 *   1) As app-level middleware (gateAdminApi) that protects everything
 *      under /api/* except the open prefixes.
 *   2) As a per-route guard (requireAdmin) for callers that want to be
 *      defensive even when the global gate already covered them.
 */

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.adminId) return res.status(401).json({ message: "請先登入管理後台" });
  try {
    const { adminService } = await import("../../modules/admin/admin.service");
    const identity = await adminService.resolveSession(req.session);
    return withAuditActor(identity.authKind === "personal"
      ? { kind: "personal", employeeId: identity.id, name: identity.name }
      : { kind: "shared_password" }, next);
  } catch (err: any) { return res.status(err.status || 503).json({ message: err.status ? err.message : "無法確認管理員身分" }); }
}

/**
 * Express middleware: gate every /api/* path that is NOT in
 * OPEN_API_PREFIXES behind the admin cookie.
 */
export async function gateAdminApi(req: Request, res: Response, next: NextFunction) {
  // Express 的路由比對不分大小寫，閘門也必須不分，否則 /API/... 會繞過登入（安全問題 S2）。
  let path: string;
  try { path = canonicalAdminPath(req.path); }
  catch { return res.status(400).json({ message: "路徑編碼錯誤" }); }
  const summerAsset = path === "/admin/summer-schedule-v40.html";
  if (!path.startsWith("/api/") && !summerAsset) return next();
  if (OPEN_API_PREFIXES.some((p) => path.startsWith(p))) return next();
  if (OPEN_API_PATHS.some((p) => path === p)) return next();
  if (!req.session?.adminId) return res.status(401).json({ message: "請先登入管理後台" });
  try {
    const { adminService } = await import("../../modules/admin/admin.service");
    const identity = await adminService.resolveSession(req.session);
    let policyBody = req.body;
    const employeePatch = /^\/api\/employees\/([0-9]+)$/.exec(path);
    const identityFields = ["role", "isAdmin", "lineId", "status"] as const;
    if (req.method === "PATCH" && employeePatch && policyBody && typeof policyBody === "object"
      && identityFields.some((key) => Object.prototype.hasOwnProperty.call(policyBody, key))
      && !hasPermission(identity.permissions, "permissions", "write")) {
      const { employeeService } = await import("../../modules/employee/employee.service");
      const current = await employeeService.getEmployee(Number(employeePatch[1]));
      if (!current) return res.status(404).json({ message: "找不到員工，無法確認身分欄位" });
      policyBody = { ...policyBody };
      for (const key of identityFields) if (Object.prototype.hasOwnProperty.call(policyBody, key) && policyBody[key] === current[key]) delete policyBody[key];
    }
    if (!allowsAdminRequest(identity.permissions, path, req.method, policyBody)) return res.status(403).json({ message: "沒有此頁面或操作的權限" });
    return withAuditActor(identity.authKind === "personal"
      ? { kind: "personal", employeeId: identity.id, name: identity.name }
      : { kind: "shared_password" }, next);
  } catch (err: any) { return res.status(err.status || 503).json({ message: err.status ? err.message : "無法確認管理員權限" }); }
}
