import { type Express } from "express";
import { type Server } from "http";
import multer from "multer";
import { anomalyService } from "./anomaly.service";

export function mountAnomalyRoutes(_httpServer: Server, app: Express): void {
  const anomalyUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("僅支援圖片檔案"));
    },
  });

  app.post("/api/anomaly-report", anomalyUpload.array("images", 5), async (req, res) => {
    try {
      const body = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body;
      const files = (req.files as Express.Multer.File[]) || [];
      const imageUrls = files.map((f) => `data:${f.mimetype};base64,${f.buffer.toString("base64")}`);

      const { record, reportText } = await anomalyService.create({
        employee: body.employee,
        clockResult: body.clockResult,
        errorMsg: body.errorMsg,
        context: body.context,
        userNote: body.userNote,
        imageUrls,
      });

      res.json({
        id: record.id,
        reportText,
        imageUrls,
        createdAt: record.createdAt,
        lineUrl: "https://lin.ee/TupPc0V",
      });
    } catch (err: any) {
      console.error("Anomaly report error:", err);
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.get("/api/anomaly-reports", async (_req, res) => {
    try {
      res.json(await anomalyService.list());
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/anomaly-reports/:id", async (req, res) => {
    try {
      const report = await anomalyService.get(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "找不到此異常報告" });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/anomaly-reports/batch/resolution", async (req, res) => {
    try {
      const { ids, resolution, resolvedNote } = req.body;
      res.json(await anomalyService.batchUpdateResolution(ids, resolution, resolvedNote));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.patch("/api/anomaly-reports/:id/resolution", async (req, res) => {
    try {
      const { resolution, resolvedNote } = req.body;
      const record = await anomalyService.updateResolution(Number(req.params.id), resolution, resolvedNote);
      if (!record) return res.status(404).json({ message: "找不到此異常報告" });
      res.json(record);
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.post("/api/anomaly-reports/batch/delete", async (req, res) => {
    try {
      res.json(await anomalyService.batchDelete(req.body?.ids));
    } catch (err: any) {
      res.status(err.status || 500).json({ message: err.message });
    }
  });

  app.delete("/api/anomaly-reports/:id", async (req, res) => {
    try {
      await anomalyService.remove(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
