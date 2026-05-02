import { type Express } from "express";
import { type Server } from "http";
import { storage } from "../../storage";
import { insertGuidelineSchema, insertGuidelineAckSchema } from "@shared/schema";

export function mountGuidelineRoutes(httpServer: Server, app: Express): void {
  app.get("/api/guidelines", async (req, res) => {
  const { category } = req.query;
  const items = await storage.getGuidelines(category ? String(category) : undefined);
  const stripped = items.map(({ imageUrl, imageUrls, ...rest }) => ({
    ...rest,
    imageCount: (imageUrls && imageUrls.length > 0) ? imageUrls.length : (imageUrl ? 1 : 0),
  }));
  res.json(stripped);
});

app.get("/api/guidelines/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const item = await storage.getGuideline(id);
  if (!item) return res.status(404).json({ message: "守則未找到" });
  res.json(item);
});

app.post("/api/guidelines", async (req, res) => {
  try {
    const parsed = insertGuidelineSchema.parse(req.body);
    const item = await storage.createGuideline(parsed);
    res.json(item);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "資料格式錯誤" });
    }
    res.status(400).json({ message: err.message });
  }
});

app.patch("/api/guidelines/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const partial = insertGuidelineSchema.partial().parse(req.body);
    const item = await storage.updateGuideline(id, partial);
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
  const id = parseInt(req.params.id);
  const deleted = await storage.deleteGuideline(id);
  if (!deleted) return res.status(404).json({ message: "守則未找到" });
  res.json({ success: true });
});

app.get("/api/guidelines/:id/acknowledgments", async (req, res) => {
  const id = parseInt(req.params.id);
  const acks = await storage.getGuidelineAcks(id);
  res.json(acks);
});

app.post("/api/guideline-ack", async (req, res) => {
  try {
    const parsed = insertGuidelineAckSchema.parse(req.body);
    const ack = await storage.createGuidelineAck(parsed);
    res.json(ack);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ message: "資料格式錯誤" });
    }
    res.status(400).json({ message: err.message });
  }
});

const isDevMode = process.env.NODE_ENV !== "production";

}

