import { type Express } from "express";
import { type Server } from "http";
import { announcements, insertAnnouncementSchema, clockAmendments, overtimeRequests, leaveRequests, anomalyReports } from "@shared/schema";
import { db } from "../../db";
import { eq, count } from "drizzle-orm";

export function mountAnnouncementRoutes(httpServer: Server, app: Express): void {
  app.get("/api/pending-counts", async (_req, res) => {
  try {
    const [caRows, otRows, lrRows, arRows] = await Promise.all([
      db.select({ cnt: count() }).from(clockAmendments).where(eq(clockAmendments.status, "pending")),
      db.select({ cnt: count() }).from(overtimeRequests).where(eq(overtimeRequests.status, "pending")),
      db.select({ cnt: count() }).from(leaveRequests).where(eq(leaveRequests.status, "pending")),
      db.select({ cnt: count() }).from(anomalyReports).where(eq(anomalyReports.resolution, "pending")),
    ]);
    const clockAmt = Number(caRows[0]?.cnt ?? 0);
    const overtimeAmt = Number(otRows[0]?.cnt ?? 0);
    const leaveAmt = Number(lrRows[0]?.cnt ?? 0);
    const anomalyAmt = Number(arRows[0]?.cnt ?? 0);
    res.json({
      clockAmendments: clockAmt,
      overtimeRequests: overtimeAmt,
      leaveRequests: leaveAmt,
      anomalyReports: anomalyAmt,
      total: clockAmt + overtimeAmt + leaveAmt + anomalyAmt,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── BRIDGE-04: Announcements ──────────────────────────────────────────────
app.post("/api/announcements", async (req, res) => {
  try {
    const parsed = insertAnnouncementSchema.parse(req.body);
    const [ann] = await db.insert(announcements).values(parsed).returning();
    res.json(ann);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

app.get("/api/announcements", async (_req, res) => {
  try {
    const all = await db.select().from(announcements).orderBy(announcements.publishedAt);
    res.json(all);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/announcements/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(announcements).where(eq(announcements.id, id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/announcements/active", async (req, res) => {
  try {
    const now = new Date();
    const all = await db.select().from(announcements).orderBy(announcements.publishedAt);
    const active = all.filter((a) => !a.expiresAt || new Date(a.expiresAt) > now);
    const regionCode = req.query.regionCode as string | undefined;
    const filtered = regionCode
      ? active.filter((a) => !a.targetRegion || a.targetRegion === regionCode)
      : active;
    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

}
