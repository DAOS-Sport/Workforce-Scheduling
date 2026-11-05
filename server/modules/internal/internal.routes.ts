/**
 * Internal API HTTP route layer (Task #72 重構 C, Task #75 split auth).
 *
 * Auth: INTERNAL_API_TOKEN — see internal.auth.ts for middleware.
 * Query helpers: see internal.helpers.ts.
 * All data assembly is delegated to internal.service.ts.
 */
import type { Express } from "express";
import {
  internalService,
  isValidDate,
  decodeCursor,
  parseLimit,
  todayInTaipei,
} from "./internal.service";
import { requireInternalToken } from "./internal.auth";
import { parseFacilityKey, sendServiceError } from "./internal.helpers";
import { syncService } from "../sync/sync.service";

export function registerInternalApi(app: Express) {
  app.use("/api/internal", requireInternalToken);

  app.get("/api/internal/admin/overview", async (_req, res) => {
    try {
      res.json(await internalService.getAdminOverview());
    } catch (err: any) {
      sendServiceError(res, "OVERVIEW_FAILED", err);
    }
  });

  app.get("/api/internal/schedules/today", async (req, res) => {
    const facilityKey = parseFacilityKey(req, res, true);
    if (facilityKey === false) return;
    try {
      res.json(await internalService.getTodaySchedules(facilityKey as string));
    } catch (err: any) {
      sendServiceError(res, "TODAY_SCHEDULE_FAILED", err);
    }
  });

  app.get("/api/internal/export/schedules", async (req, res) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
    }
    if (from > to) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
    }
    const facilityKey = parseFacilityKey(req, res, false);
    if (facilityKey === false) return;
    const employeeNumber = req.query.employeeNumber ? String(req.query.employeeNumber).trim() : "";
    const includeDeleted = String(req.query.includeDeleted ?? "false").toLowerCase() === "true";
    const includeDispatch = String(req.query.includeDispatch ?? "true").toLowerCase() !== "false";
    const limit = parseLimit(req.query.limit);
    const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

    try {
      res.json(await internalService.exportSchedules({
        from, to, facilityKey: facilityKey as string, employeeNumber, includeDeleted, includeDispatch, limit, offset,
      }));
    } catch (err: any) {
      sendServiceError(res, "EXPORT_SCHEDULES_FAILED", err);
    }
  });

  app.get("/api/internal/export/employees", async (req, res) => {
    const status = String(req.query.status ?? "active").toLowerCase();
    const facilityKey = parseFacilityKey(req, res, false);
    if (facilityKey === false) return;
    const limit = parseLimit(req.query.limit);
    const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

    try {
      res.json(await internalService.exportEmployees({ status, facilityKey: facilityKey as string, limit, offset }));
    } catch (err: any) {
      sendServiceError(res, "EXPORT_EMPLOYEES_FAILED", err);
    }
  });

  app.get("/api/internal/export/venues", async (_req, res) => {
    try {
      res.json(await internalService.exportVenues());
    } catch (err: any) {
      sendServiceError(res, "EXPORT_VENUES_FAILED", err);
    }
  });

  app.get("/api/internal/export/shifts", async (_req, res) => {
    try {
      res.json(await internalService.exportShiftTemplates());
    } catch (err: any) {
      sendServiceError(res, "EXPORT_SHIFTS_FAILED", err);
    }
  });

  app.get("/api/internal/export/changes", async (req, res) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
    }
    if (from > to) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
    }
    const facilityKey = parseFacilityKey(req, res, false);
    if (facilityKey === false) return;
    const limit = parseLimit(req.query.limit);
    const offset = decodeCursor(typeof req.query.cursor === "string" ? req.query.cursor : undefined);

    try {
      res.json(await internalService.exportChanges({ from, to, facilityKey: facilityKey as string, limit, offset }));
    } catch (err: any) {
      sendServiceError(res, "EXPORT_CHANGES_FAILED", err);
    }
  });

  app.get("/api/internal/export/snapshot", async (req, res) => {
    const from = String(req.query.from ?? todayInTaipei());
    const to = String(req.query.to ?? from);
    if (!isValidDate(from) || !isValidDate(to)) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from and to must be YYYY-MM-DD" });
    }
    if (from > to) {
      return res.status(400).json({ code: "INVALID_DATE_RANGE", message: "from must be <= to" });
    }
    const facilityKey = parseFacilityKey(req, res, false);
    if (facilityKey === false) return;

    try {
      res.json(await internalService.exportSnapshot({ from, to, facilityKey: facilityKey as string }));
    } catch (err: any) {
      sendServiceError(res, "EXPORT_SNAPSHOT_FAILED", err);
    }
  });

  app.post("/api/internal/trigger-weekly-schedule", async (_req, res) => {
    try {
      const result = await syncService.weeklySchedule();
      res.status("busy" in result ? 202 : 200).json({ ok: true, ...result });
    } catch (err: any) {
      sendServiceError(res, "TRIGGER_WEEKLY_SCHEDULE_FAILED", err);
    }
  });

  app.use("/api/internal", (_req, res) => {
    res.status(404).json({ code: "INTERNAL_ROUTE_NOT_FOUND", message: "Not found" });
  });
}
