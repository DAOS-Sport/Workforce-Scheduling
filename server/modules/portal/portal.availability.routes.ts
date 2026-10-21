/**
 * Portal availability sub-routes — employee shift availability (排班意願).
 * Endpoints:
 *   GET    /api/portal/monthly-holidays/:yearMonth  (public — no auth needed)
 *   GET    /api/portal/availability-window  (public — no auth needed)
 *   GET    /api/portal/my-availabilities/:employeeId/:yearMonth
 *   POST   /api/portal/availability
 *   DELETE /api/portal/availability/:id
 */
import { type Express } from "express";
import { type Server } from "http";
import {
  getMonthlyHolidays,
  getAvailabilityWindow,
  listMyAvailabilities,
  submitAvailability,
  withdrawAvailability,
} from "./portal.availability.service";
import { ok, created, fail } from "../../shared/http/response";

function extractLineUserId(req: import("express").Request): string | undefined {
  return (req.header("x-line-user-id") as string | undefined) ??
    (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
}

export function mountPortalAvailabilityRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/monthly-holidays/:yearMonth", async (req, res) => {
    try {
      ok(res, await getMonthlyHolidays(req.params.yearMonth));
    } catch (err: any) { fail(res, err.status || 500, err.message); }
  });

  app.get("/api/portal/availability-window", async (_req, res) => {
    try {
      ok(res, await getAvailabilityWindow());
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/portal/my-availabilities/:employeeId/:yearMonth", async (req, res) => {
    try {
      ok(res, await listMyAvailabilities(req.params.employeeId, req.params.yearMonth, extractLineUserId(req)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message, err.extra);
    }
  });

  app.post("/api/portal/availability", async (req, res) => {
    try {
      created(res, await submitAvailability(req.body, extractLineUserId(req)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message, err.extra);
    }
  });

  app.delete("/api/portal/availability/:id", async (req, res) => {
    try {
      ok(res, await withdrawAvailability(req.params.id, extractLineUserId(req)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message, err.extra);
    }
  });
}
