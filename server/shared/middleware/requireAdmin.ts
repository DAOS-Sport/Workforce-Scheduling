import type { Request, Response, NextFunction } from "express";
import { OPEN_API_PATHS, OPEN_API_PREFIXES } from "../../config/openApiPrefixes";

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

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.adminId) return next();
  return res.status(401).json({ message: "請先登入管理後台" });
}

/**
 * Express middleware: gate every /api/* path that is NOT in
 * OPEN_API_PREFIXES behind the admin cookie.
 */
export function gateAdminApi(req: Request, res: Response, next: NextFunction) {
  // Express 的路由比對不分大小寫，閘門也必須不分，否則 /API/... 會繞過登入（安全問題 S2）。
  const path = req.path.toLowerCase();
  if (!path.startsWith("/api/")) return next();
  if (OPEN_API_PREFIXES.some((p) => path.startsWith(p))) return next();
  if (OPEN_API_PATHS.some((p) => path === p)) return next();
  return requireAdmin(req, res, next);
}
