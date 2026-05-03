/**
 * Portal module umbrella router — Task #71 重構 B split into 5 sub-files:
 *   - portal.auth.routes.ts        — dev-login + LINE callback + verify
 *   - portal.shifts.routes.ts      — my-shifts + certificate upload
 *   - portal.workmates.routes.ts   — today / 7-day coworker discovery
 *   - portal.guidelines.routes.ts  — guideline list / detail / ack-all
 *   - portal.attendance.routes.ts  — monthly attendance summary
 *
 * (Clock amendments / overtime / leave endpoints under /api/portal/* live
 * in the `clock` / `overtime` / `leave` modules respectively.)
 */
import { type Express } from "express";
import { type Server } from "http";
import { mountPortalAuthRoutes } from "./portal.auth.routes";
import { mountPortalShiftsRoutes } from "./portal.shifts.routes";
import { mountPortalWorkmatesRoutes } from "./portal.workmates.routes";
import { mountPortalGuidelinesRoutes } from "./portal.guidelines.routes";
import { mountPortalAttendanceRoutes } from "./portal.attendance.routes";

export function mountPortalRoutes(httpServer: Server, app: Express): void {
  mountPortalAuthRoutes(httpServer, app);
  mountPortalShiftsRoutes(httpServer, app);
  mountPortalWorkmatesRoutes(httpServer, app);
  mountPortalGuidelinesRoutes(httpServer, app);
  mountPortalAttendanceRoutes(httpServer, app);
}
