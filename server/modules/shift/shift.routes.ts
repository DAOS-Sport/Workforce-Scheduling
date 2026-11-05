/**
 * Shift module HTTP routes: every route under /api/shifts/* and
 * /api/shifts-cancelled/*. Handlers read params, body and the session
 * actor, call shift.service.ts, and write the response.
 *
 * A ZodError is a 400 and an httpError keeps its own status. Any other error is
 * unexpected and goes to the global error handler (500, recorded). The reads,
 * single delete and restore have no catch and fall through to it as well.
 */
import type { Express, Request, Response } from "express";
import { HttpError } from "../../shared/errors";
import { fail } from "../../shared/http/response";
import {
  listShifts,
  listCancelledShifts,
  listRegionShifts,
  getShiftAuditLog,
  fourWeekPrecheck,
  createShift,
  updateShift,
  cancelShift,
  restoreShift,
  batchDeleteShifts,
  batchDeleteShiftIds,
  batchUpsertShifts,
  importShifts,
  batchUpdateShifts,
  copyShiftsFromPreviousMonth,
} from "./shift.service";

function actorOf(req: Request): string {
  return req.session.adminName || "admin";
}

function failShiftWrite(res: Response, err: any) {
  if (err.name === "ZodError") return fail(res, 400, "排班資料格式錯誤");
  if (!(err instanceof HttpError)) throw err;
  fail(res, err.status, err.message);
}

export function mountShiftRoutes(app: Express): void {
  // ── Reads ────────────────────────────────────────────────────────────

  app.get("/api/shifts/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    res.json(await listShifts(regionCode, startDate, endDate));
  });

  app.get("/api/shifts-cancelled/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    res.json(await listCancelledShifts(regionCode, startDate, endDate));
  });

  // Spec'd endpoint per Task #50: returns active shifts by default; includes
  // cancelled rows when ?includeCancelled=1 is passed.
  app.get("/api/shifts/:regionCode/:startDate/:endDate/all", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const includeCancelled = req.query.includeCancelled === "1" || req.query.includeCancelled === "true";
    res.json(await listRegionShifts(regionCode, startDate, endDate, includeCancelled));
  });

  app.get("/api/shifts/:id/audit", async (req, res) => {
    res.json(await getShiftAuditLog(parseInt(req.params.id)));
  });

  // ── Validation precheck ──────────────────────────────────────────────

  app.post("/api/shifts/four-week-precheck", async (req, res) => {
    try {
      res.json(await fourWeekPrecheck(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // ── Single-shift CRUD ───────────────────────────────────────────────

  app.post("/api/shifts", async (req, res) => {
    try {
      res.json(await createShift(req.body, actorOf(req)));
    } catch (err: any) {
      failShiftWrite(res, err);
    }
  });

  app.patch("/api/shifts/:id", async (req, res) => {
    try {
      res.json(await updateShift(parseInt(req.params.id), req.body, actorOf(req)));
    } catch (err: any) {
      failShiftWrite(res, err);
    }
  });

  app.delete("/api/shifts/:id", async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const deleted = await cancelShift(parseInt(req.params.id), actorOf(req), reason);
    if (!deleted) return res.status(404).json({ message: "Shift not found or already cancelled" });
    res.json({ success: true });
  });

  app.post("/api/shifts/:id/restore", async (req, res) => {
    const restored = await restoreShift(parseInt(req.params.id), actorOf(req));
    if (!restored) return res.status(404).json({ message: "Shift not found or not cancelled" });
    res.json(restored);
  });

  // ── Batch operations ────────────────────────────────────────────────

  app.post("/api/shifts/batch-delete", async (req, res) => {
    try {
      res.json(await batchDeleteShifts(req.body, actorOf(req)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/shifts/batch-delete-ids", async (req, res) => {
    try {
      res.json(await batchDeleteShiftIds(req.body, actorOf(req)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/shifts/batch", async (req, res) => {
    try {
      res.json(await batchUpsertShifts(req.body, actorOf(req)));
    } catch (err: any) {
      failShiftWrite(res, err);
    }
  });

  app.post("/api/shifts/import-batch", async (req, res) => {
    try {
      res.json(await importShifts(req.body, actorOf(req)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/shifts/batch-update", async (req, res) => {
    try {
      res.json(await batchUpdateShifts(req.body, actorOf(req)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/shifts/copy-from-previous", async (req, res) => {
    try {
      res.json(await copyShiftsFromPreviousMonth(req.body, actorOf(req)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
