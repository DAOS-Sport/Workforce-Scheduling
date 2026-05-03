import { type Express } from "express";
import { type Server } from "http";
import { guidelineService } from "./guideline.service";

export function mountGuidelineRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/guidelines", async (req, res) => {
    const { category } = req.query;
    res.json(await guidelineService.list(category ? String(category) : undefined));
  });

  app.get("/api/guidelines/:id", async (req, res) => {
    const item = await guidelineService.get(parseInt(req.params.id));
    if (!item) return res.status(404).json({ message: "守則未找到" });
    res.json(item);
  });

  app.post("/api/guidelines", async (req, res) => {
    try {
      res.json(await guidelineService.create(req.body));
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/guidelines/:id", async (req, res) => {
    try {
      const item = await guidelineService.update(parseInt(req.params.id), req.body);
      if (!item) return res.status(404).json({ message: "守則未找到" });
      res.json(item);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/guidelines/:id", async (req, res) => {
    const deleted = await guidelineService.remove(parseInt(req.params.id));
    if (!deleted) return res.status(404).json({ message: "守則未找到" });
    res.json({ success: true });
  });

  app.get("/api/guidelines/:id/acknowledgments", async (req, res) => {
    res.json(await guidelineService.acks(parseInt(req.params.id)));
  });

  app.post("/api/guideline-ack", async (req, res) => {
    try {
      res.json(await guidelineService.createAck(req.body));
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });
}
