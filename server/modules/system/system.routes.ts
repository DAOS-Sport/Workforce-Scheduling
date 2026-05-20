/**
 * System module umbrella router — Task #71 重構 B split into 3 sub-files:
 *   - system.config.routes.ts     — salary-rates + system-config CRUD
 *   - system.salary.routes.ts     — salary-report + weekly-attendance
 *   - system.fourWeek.routes.ts   — four-week-compliance
 *   - system.observability.routes.ts — health / metrics / logs (Task #97)
 *
 * (anomaly email + test-email endpoints live in the `notification` /
 * `anomaly` modules, not here.)
 */
import { type Express } from "express";
import { type Server } from "http";
import { mountSystemConfigRoutes } from "./system.config.routes";
import { mountSystemSalaryRoutes } from "./system.salary.routes";
import { mountSystemFourWeekRoutes } from "./system.fourWeek.routes";
import { mountSystemObservabilityRoutes } from "./system.observability.routes";

export function mountSystemRoutes(httpServer: Server, app: Express): void {
  mountSystemConfigRoutes(httpServer, app);
  mountSystemSalaryRoutes(httpServer, app);
  mountSystemFourWeekRoutes(httpServer, app);
  mountSystemObservabilityRoutes(app);
}
