import { type Express } from "express";
import { type Server } from "http";
import multer from "multer";
import { z } from "zod";
import { anomalyService } from "./anomaly.service";
import { ok, created, fail, notFound } from "../../shared/http/response";
import { recordLog } from "../../shared/logging/collector";

const geolocationFailure = z.object({
  event: z.literal("geolocation_failure"),
  kind: z.enum(["PERMISSION_DENIED", "POSITION_UNAVAILABLE", "TIMEOUT", "UNSUPPORTED", "INSECURE_CONTEXT", "POOR_ACCURACY", "UNKNOWN"]),
  entry: z.enum(["liff", "portal"]),
  platform: z.enum(["iOS", "Android", "other"]),
  inLine: z.boolean(),
}).strict();

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
      if (body?.event === "geolocation_failure") {
        const parsed = geolocationFailure.safeParse(body);
        if (!parsed.success) return fail(res, 400, "定位失敗回報格式不正確");
        const { kind, entry, platform, inLine } = parsed.data;
        recordLog("warn", `geolocation_failure ${JSON.stringify({ kind, entry, platform, inLine })}`, "clock.coverage");
        return ok(res, { received: true });
      }
      const files = (req.files as Express.Multer.File[]) || [];
      const imageUrls = files.map((f) => `data:${f.mimetype};base64,${f.buffer.toString("base64")}`);
      const { record, reportText } = await anomalyService.create({
        employee: body.employee, clockResult: body.clockResult, errorMsg: body.errorMsg,
        context: body.context, userNote: body.userNote, imageUrls,
      });
      created(res, { id: record.id, reportText, imageUrls, createdAt: record.createdAt, lineUrl: "https://lin.ee/TupPc0V" });
    } catch (err: any) {
      console.error("Anomaly report error:", err);
      fail(res, err.status || 500, err.message);
    }
  });

  app.get("/api/anomaly-reports", async (_req, res) => {
    try {
      ok(res, await anomalyService.list());
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/anomaly-reports/:id", async (req, res) => {
    try {
      const report = await anomalyService.get(Number(req.params.id));
      if (!report) return notFound(res, "找不到此異常報告");
      ok(res, report);
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.patch("/api/anomaly-reports/batch/resolution", async (req, res) => {
    try {
      const { ids, resolution, resolvedNote } = req.body;
      ok(res, await anomalyService.batchUpdateResolution(ids, resolution, resolvedNote));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.patch("/api/anomaly-reports/:id/resolution", async (req, res) => {
    try {
      const { resolution, resolvedNote } = req.body;
      const record = await anomalyService.updateResolution(Number(req.params.id), resolution, resolvedNote);
      if (!record) return notFound(res, "找不到此異常報告");
      ok(res, record);
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.post("/api/anomaly-reports/batch/delete", async (req, res) => {
    try {
      ok(res, await anomalyService.batchDelete(req.body?.ids));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.delete("/api/anomaly-reports/:id", async (req, res) => {
    try {
      await anomalyService.remove(Number(req.params.id));
      ok(res, { success: true });
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
