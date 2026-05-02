/**
 * Module registry — single fan-out point for HTTP route registration.
 *
 * Today only the shift module owns its routes file. All other domains
 * still register inline in routes.ts; their migration into per-module
 * route files is tracked as follow-up work to Task #69.
 *
 * To add a new module:
 *   1. Create modules/<name>/<name>.routes.ts that exports
 *      `mount<Name>Routes(app)`.
 *   2. Import + call it here.
 *   3. Remove the corresponding routes from routes.ts.
 */
import type { Express } from "express";
import { mountShiftRoutes } from "./shift/shift.routes";

export function registerModuleRoutes(app: Express): void {
  mountShiftRoutes(app);
}
