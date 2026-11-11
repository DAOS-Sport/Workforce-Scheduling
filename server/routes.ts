/**
 * Thin HTTP route delegator — Task #69 architecture refactor.
 *
 * After the refactor this file is intentionally tiny: it only owns
 *   1. The CORS shim middlewares for routes consumed by the external
 *      anomaly dashboard (anomaly-report / anomaly-reports /
 *      notification-recipients / test-email).
 *   2. The auth-bootstrap order: admin auth routes MUST be mounted before
 *      registerInternalApi() (X-Internal-Token bypass) and gateAdminApi
 *      (the cookie gate), so they are wired here in explicit order.
 *   3. The single fan-out call into the module registry.
 *
 * All domain HTTP routes live in server/modules/<name>/<name>.routes.ts.
 * Shift protections (Task #50 force=true), audit-log writes, and
 * soft-delete semantics live in the shift and dispatch repositories.
 */
import type { Express } from "express";
import type { Server } from "http";

import { registerInternalApi } from "./modules/internal/internal.routes";
import { gateAdminApi } from "./shared/middleware/requireAdmin";
import { registerModuleRoutes } from "./modules/_registry";
import { mountAdminAuthRoutes } from "./modules/admin/admin.routes";
import { mountAdminPermissionsRoutes } from "./modules/admin/admin.permissions.routes";
import { mountAuditRoutes } from "./modules/audit/audit.routes";
import { corsFor } from "./shared/middleware/cors";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ── 1. CORS shims for externally-consumed endpoints ────────────────────
  app.use("/api/anomaly-report",          corsFor("GET, POST, OPTIONS"));
  app.use("/api/anomaly-reports",         corsFor("GET, PATCH, DELETE, OPTIONS"));
  app.use("/api/notification-recipients", corsFor("GET, POST, PATCH, DELETE, OPTIONS"));
  app.use("/api/test-email",              corsFor("POST, OPTIONS"));

  // ── 2. Auth bootstrap (strict order matters!) ──────────────────────────
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
  mountAdminPermissionsRoutes(app);
  mountAuditRoutes(app);

  // ── 3. Domain modules ──────────────────────────────────────────────────
  registerModuleRoutes(httpServer, app);

  return httpServer;
}
