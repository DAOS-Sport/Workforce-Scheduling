/**
 * Module registry — single fan-out point for all HTTP route registration.
 *
 * Every domain owns its own server/modules/<name>/<name>.routes.ts file
 * exposing a mount<Name>Routes(httpServer, app) function. routes.ts is now
 * a thin delegator that just calls this registry; it no longer contains
 * any inline domain routes.
 *
 * The shift module is the canonical, fully-decomposed module
 * (types/repository/audit/validation/service/routes). The other 16
 * modules are pure route extractions for now — their handlers still call
 * `storage.*` directly. Per-domain repository/service decomposition is
 * tracked as Task #67 / #68 follow-up work.
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
import { mountLineLiffRoutes } from "./line/line.routes";
import { mountClockRoutes } from "./clock/clock.routes";
import { mountOvertimeRoutes } from "./overtime/overtime.routes";
import { mountAnomalyRoutes } from "./anomaly/anomaly.routes";
import { mountNotificationRoutes } from "./notification/notification.routes";
import { mountSystemRoutes } from "./system/system.routes";
import { mountLeaveRoutes } from "./leave/leave.routes";
import { mountAnnouncementRoutes } from "./announcement/announcement.routes";
import { mountImportExportRoutes } from "./importExport";

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
  mountLineLiffRoutes(httpServer, app);
  mountClockRoutes(httpServer, app);
  mountOvertimeRoutes(httpServer, app);
  mountAnomalyRoutes(httpServer, app);
  mountNotificationRoutes(httpServer, app);
  mountSystemRoutes(httpServer, app);
  mountLeaveRoutes(httpServer, app);
  mountAnnouncementRoutes(httpServer, app);

  // Spreadsheet ingest boundaries (XLSX → multi-table writes)
  mountImportExportRoutes(httpServer, app);
}
