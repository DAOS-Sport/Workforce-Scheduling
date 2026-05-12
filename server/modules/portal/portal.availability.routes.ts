/**
 * Portal availability sub-routes — employee shift availability (排班意願).
 * Endpoints:
 *   GET    /api/portal/my-availabilities/:employeeId/:yearMonth
 *   POST   /api/portal/availability
 *   DELETE /api/portal/availability/:id
 *   GET    /api/portal/availability-window  (public — no auth needed)
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";
import { availabilityRepository } from "../availability/availability.repository";
import { storage } from "../../storage";
import { ok, created, fail, badRequest, notFound } from "../../shared/http/response";

function extractLineUserId(req: import("express").Request): string | undefined {
  return (req.header("x-line-user-id") as string | undefined) ??
    (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
}

export function mountPortalAvailabilityRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/availability-window", async (_req, res) => {
    try {
      const cfg = await storage.getSystemConfig("availability_window");
      if (!cfg) return ok(res, null);
      try {
        ok(res, JSON.parse(cfg.value));
      } catch {
        ok(res, null);
      }
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/portal/my-availabilities/:employeeId/:yearMonth", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      if (isNaN(employeeId)) return badRequest(res, "無效的員工 ID");
      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      const { yearMonth } = req.params;
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) return badRequest(res, "yearMonth 格式須為 YYYY-MM");
      ok(res, await availabilityRepository.getByEmployeeAndYearMonth(employeeId, yearMonth));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/portal/availability", async (req, res) => {
    try {
      const { employeeId, date, startTime, endTime, note } = req.body;
      if (!employeeId || !date || !startTime || !endTime) return badRequest(res, "缺少必要欄位");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, "date 格式須為 YYYY-MM-DD");
      if (startTime >= endTime) return badRequest(res, "結束時間必須晚於開始時間");
      const auth = await portalService.verifyCaller(Number(employeeId), extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      const row = await availabilityRepository.create({
        employeeId: Number(employeeId),
        date,
        startTime,
        endTime,
        note: note?.trim() || null,
      });
      created(res, row);
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.delete("/api/portal/availability/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return badRequest(res, "無效的 ID");
      const row = await availabilityRepository.getById(id);
      if (!row) return notFound(res, "找不到此意願紀錄");
      const auth = await portalService.verifyCaller(row.employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      await availabilityRepository.delete(id);
      ok(res, { success: true });
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
