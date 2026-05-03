import { type Express } from "express";
import { type Server } from "http";
import multer from "multer";
import { importExportService } from "./importExport.service";

export function mountAttendanceImportRoutes(_httpServer: Server, app: Express): void {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  app.post("/api/attendance-upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "請選擇檔案" });
      }
      const result = await importExportService.importAttendanceXlsx(req.file.buffer, req.file.originalname);
      res.json(result);
    } catch (err: any) {
      console.error("Upload error:", err);
      res.status(err.status || 500).json({ message: err.status ? err.message : "匯入失敗：" + err.message });
    }
  });
}
