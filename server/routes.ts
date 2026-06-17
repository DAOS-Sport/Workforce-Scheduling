/**
 * Thin HTTP route delegator — Task #69 architecture refactor.
 *
 * After the refactor this file is intentionally tiny: it only owns
 *   1. The seed step (default 病假 guideline) — a one-shot bootstrap concern
 *      that runs alongside route registration.
 *   2. The CORS shim middlewares for routes consumed by the external
 *      anomaly dashboard (anomaly-report / anomaly-reports /
 *      notification-recipients / test-email).
 *   3. The auth-bootstrap order: admin auth routes MUST be mounted before
 *      registerInternalApi() (X-Internal-Token bypass) and gateAdminApi
 *      (the cookie gate), so they are wired here in explicit order.
 *   4. The single fan-out call into the module registry.
 *
 * All domain HTTP routes live in server/modules/<name>/<name>.routes.ts.
 * Storage protections (Task #50 force=true), audit-log writes, and
 * soft-delete semantics remain inside server/storage.ts unchanged.
 */
import type { Express } from "express";
import type { Server } from "http";

import { storage } from "./storage";
import { registerInternalApi } from "./modules/internal/internal.routes";
import { gateAdminApi } from "./shared/middleware/requireAdmin";
import { registerModuleRoutes } from "./modules/_registry";
import { mountAdminAuthRoutes } from "./modules/admin/admin.routes";
import { corsFor } from "./shared/middleware/cors";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ── 1. Seed: default guideline ─────────────────────────────────────────
  try {
    const existingGuidelines = await storage.getGuidelines("工作規則");
    const hasSickLeave = existingGuidelines.some((g) => g.title === "病假注意事項");
    if (!hasSickLeave) {
      await storage.createGuideline({
        category: "工作規則",
        title: "病假注意事項",
        content: "請病假需於返回上班後三日內提交就診證明（醫院收據或診斷書），否則將視同曠職。如有疑問請洽詢主管或 HR 部門。",
        contentType: "text",
        sortOrder: 10,
        isActive: true,
      });
      console.log("[Seed] 已新增病假注意事項 guideline");
    }
  } catch (e) {
    console.error("[Seed] 初始化 guideline 失敗:", e);
  }

  // ── 2. CORS shims for externally-consumed endpoints ────────────────────
  app.use("/api/anomaly-report",          corsFor("GET, POST, OPTIONS"));
  app.use("/api/anomaly-reports",         corsFor("GET, PATCH, DELETE, OPTIONS"));
  app.use("/api/notification-recipients", corsFor("GET, POST, PATCH, DELETE, OPTIONS"));
  app.use("/api/test-email",              corsFor("POST, OPTIONS"));

  // ── 3. Auth bootstrap (strict order matters!) ──────────────────────────
  //   a) Admin auth routes — mount BEFORE the gate so /api/admin/login
  //      itself isn't blocked. Admin auth routes are mounted before gateAdminApi, so login/me/logout remain reachable.
  mountAdminAuthRoutes(httpServer, app);
  //   b) Internal server-to-server API (X-Internal-Token auth). Registered
  //      BEFORE the admin-cookie middleware so it never falls through to
  //      requireAdmin, and /api/internal/ is also in OPEN_API_PREFIXES.
  registerInternalApi(app);
  //   c) Single shared admin gate. Public-prefix bypass list lives in
  //      server/config/openApiPrefixes.ts.
  app.use(gateAdminApi);

  // ── 4. Domain modules ──────────────────────────────────────────────────
  registerModuleRoutes(httpServer, app);

  return httpServer;
}
