/**
 * Module registry — single fan-out point for all HTTP route registration.
 *
 * Every domain owns its own server/modules/<name>/<name>.routes.ts file
 * exposing a mount<Name>Routes(httpServer, app) function. routes.ts is now
 * a thin delegator that just calls this registry; it no longer contains
 * any inline domain routes.
 *
 * The shift module is the canonical, fully-decomposed module
 * (types/repository/audit/validation/service/routes). All 19 other
 * modules now also have a `<name>.service.ts` (Task #70 重構 A) — routes
 * import from `xxxService`, never from `storage` directly. Service-layer
 * naming convention: `xxxService.findAll() / get(id) / create(data, actor) /
 * update(id, patch, actor) / remove(id)`. Errors throw with `.status` set;
 * the route catch-block uses `err.status || 500`.
 *
 * Task #71 重構 B: the three largest route files (portal/clock/system)
 * are further split into per-feature sub-route files (e.g.
 * `portal.auth.routes.ts`, `portal.workmates.routes.ts`,
 * `clock.amendment.routes.ts`, `system.salary.routes.ts`); each module's
 * top-level `<name>.routes.ts` is now a thin umbrella that calls the
 * sub-mounts. The registry signature is unchanged.
 */
import type { Express } from "express";
import type { Server } from "http";

import { mountShiftRoutes } from "./shift/shift.routes";
import { mountAdminAuthRoutes } from "./admin/admin.routes";
import { mountRegionRoutes } from "./region/region.routes";
import { mountEmployeeRoutes } from "./employee/employee.routes";
import { mountVenueRoutes } from "./venue/venue.routes";
import { mountDispatchRoutes } from "./dispatch/dispatch.routes";
import { mountScheduleSlotRoutes } from "./scheduleSlot/scheduleSlot.routes";
import { mountAttendanceRoutes } from "./attendance/attendance.routes";
import { mountGuidelineRoutes } from "./guideline/guideline.routes";
import { mountPortalRoutes } from "./portal/portal.routes";
import { mountSyncRoutes } from "./sync/sync.routes";
import { mountRagicRoutes } from "./ragic/ragic.routes";
import { mountLineRoutes } from "./line/line.routes";
import { mountLiffRoutes } from "./liff/liff.routes";
import { mountClockRoutes } from "./clock/clock.routes";
import { mountOvertimeRoutes } from "./overtime/overtime.routes";
import { mountAnomalyRoutes } from "./anomaly/anomaly.routes";
import { mountNotificationRoutes } from "./notification/notification.routes";
import { mountSystemRoutes } from "./system/system.routes";
import { mountLeaveRoutes } from "./leave/leave.routes";
import { mountAnnouncementRoutes } from "./announcement/announcement.routes";
import { mountImportExportRoutes } from "./importExport";
import { mountAvailabilityRoutes } from "./availability/availability.routes";

export function registerModuleRoutes(httpServer: Server, app: Express): void {
  // Shift module — fully decomposed (the canonical pattern)
  mountShiftRoutes(app);

  // Domain modules (pure route extraction; storage.ts remains source of truth)
  mountRegionRoutes(httpServer, app);
  mountEmployeeRoutes(httpServer, app);
  mountVenueRoutes(httpServer, app);
  mountDispatchRoutes(httpServer, app);
  mountScheduleSlotRoutes(httpServer, app);
  mountAttendanceRoutes(httpServer, app);
  mountGuidelineRoutes(httpServer, app);
  mountPortalRoutes(httpServer, app);
  mountSyncRoutes(httpServer, app);
  mountRagicRoutes(httpServer, app);
  mountLineRoutes(httpServer, app);
  mountLiffRoutes(httpServer, app);
  mountClockRoutes(httpServer, app);
  mountOvertimeRoutes(httpServer, app);
  mountAnomalyRoutes(httpServer, app);
  mountNotificationRoutes(httpServer, app);
  mountSystemRoutes(httpServer, app);
  mountLeaveRoutes(httpServer, app);
  mountAnnouncementRoutes(httpServer, app);

  mountAvailabilityRoutes(httpServer, app);

  // Spreadsheet ingest boundaries (XLSX → multi-table writes)
  mountImportExportRoutes(httpServer, app);
}
