import { type Express } from "express";
import { type Server } from "http";
import { storage } from "../../storage";

/**
 * Attendance CRUD routes only.  The XLSX import handler
 * (POST /api/attendance-upload) lives in modules/importExport/ because file
 * parsing concerns are orthogonal to read/delete on the resulting rows.
 */
export function mountAttendanceRoutes(httpServer: Server, app: Express): void {
  app.get("/api/attendance-uploads", async (_req, res) => {
    const uploads = await storage.getAttendanceUploads();
    res.json(uploads);
  });

  app.get("/api/attendance-records/:uploadId", async (req, res) => {
    const uploadId = parseInt(req.params.uploadId);
    const records = await storage.getAttendanceRecordsByUpload(uploadId);
    res.json(records);
  });

  app.get("/api/attendance-records", async (req, res) => {
    const { startDate, endDate, employeeCodes } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "請提供 startDate 和 endDate" });
    }
    const codes = employeeCodes ? String(employeeCodes).split(",") : undefined;
    const records = await storage.getAttendanceRecordsByDateRange(
      String(startDate),
      String(endDate),
      codes
    );
    res.json(records);
  });

  app.delete("/api/attendance-upload/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteAttendanceRecordsByUpload(id);
    const deleted = await storage.deleteAttendanceUpload(id);
    if (!deleted) return res.status(404).json({ message: "Upload not found" });
    res.json({ success: true });
  });
}
