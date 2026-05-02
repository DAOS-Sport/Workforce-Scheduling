/**
 * importExport module
 *
 * Owns spreadsheet (XLSX) ingestion / data-import boundaries that span more than
 * one persistence domain.  Currently hosts the attendance punch-record import
 * (POST /api/attendance-upload) — extracted from attendance/ because XLSX
 * parsing concerns (multer, ExcelJS, header coercion) are orthogonal to the
 * CRUD endpoints that read/write the resulting rows.
 *
 * Other domain modules keep their domain-specific batch endpoints (e.g.
 * shift/import-batch) inside the domain itself; routes only graduate here when
 * they parse uploaded files into multiple persistence operations.
 */
import { type Express } from "express";
import { type Server } from "http";
import { mountAttendanceImportRoutes } from "./attendanceImport.routes";

export function mountImportExportRoutes(httpServer: Server, app: Express): void {
  mountAttendanceImportRoutes(httpServer, app);
}
