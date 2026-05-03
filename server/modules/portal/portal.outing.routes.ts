/**
 * Portal outing sub-routes — employee outdoor sign-in/out records.
 * Endpoints:
 *   POST   /api/portal/outing-record
 *   GET    /api/portal/outing-records/:employeeId
 *   GET    /api/outing-records          (admin — all records)
 */
import { type Express } from "express";
import { type Server } from "http";
import { db } from "../../db";
import { outingRecords } from "../../../shared/schema";
import { eq, desc } from "drizzle-orm";

export function mountPortalOutingRoutes(_httpServer: Server, app: Express): void {
  // Create a new outing record (employee self-service)
  app.post("/api/portal/outing-record", async (req, res) => {
    try {
      const { employeeId, outType, destination, note, latitude, longitude, accuracy, imageUrl } = req.body;

      if (!employeeId || !outType || latitude == null || longitude == null) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      if (!["out", "return"].includes(outType)) {
        return res.status(400).json({ message: "outType 必須為 out 或 return" });
      }
      if (outType === "out" && !destination?.trim()) {
        return res.status(400).json({ message: "外出簽到需填寫地點/事由" });
      }

      const [record] = await db
        .insert(outingRecords)
        .values({
          employeeId: Number(employeeId),
          outType,
          destination: destination?.trim() || null,
          note: note?.trim() || null,
          latitude: Number(latitude),
          longitude: Number(longitude),
          accuracy: accuracy != null ? Number(accuracy) : null,
          imageUrl: imageUrl || null,
          status: "submitted",
        })
        .returning();

      res.json(record);
    } catch (err: any) {
      console.error("Outing record create error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // List all outing records for one employee (most recent first)
  app.get("/api/portal/outing-records/:employeeId", async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      if (isNaN(employeeId)) return res.status(400).json({ message: "無效的員工 ID" });

      const records = await db
        .select()
        .from(outingRecords)
        .where(eq(outingRecords.employeeId, employeeId))
        .orderBy(desc(outingRecords.createdAt));

      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Admin: list all outing records
  app.get("/api/outing-records", async (_req, res) => {
    try {
      const records = await db
        .select()
        .from(outingRecords)
        .orderBy(desc(outingRecords.createdAt));
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
