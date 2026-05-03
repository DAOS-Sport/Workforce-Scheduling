import { type Express } from "express";
import { type Server } from "http";
import { attendanceService } from "./attendance.service";
import { ok, fail, notFound, badRequest } from "../../shared/http/response";

export function mountAttendanceRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/attendance-uploads", async (_req, res) => {
    ok(res, await attendanceService.listUploads());
  });

  app.get("/api/attendance-records/:uploadId", async (req, res) => {
    ok(res, await attendanceService.recordsByUpload(parseInt(req.params.uploadId)));
  });

  app.get("/api/attendance-records", async (req, res) => {
    const { startDate, endDate, employeeCodes } = req.query;
    if (!startDate || !endDate) return badRequest(res, "請提供 startDate 和 endDate");
    const codes = employeeCodes ? String(employeeCodes).split(",") : undefined;
    ok(res, await attendanceService.recordsByDateRange(String(startDate), String(endDate), codes));
  });

  app.delete("/api/attendance-upload/:id", async (req, res) => {
    const deleted = await attendanceService.deleteUpload(parseInt(req.params.id));
    if (!deleted) return notFound(res, "Upload not found");
    ok(res, { success: true });
  });
}
