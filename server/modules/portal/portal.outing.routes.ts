/**
 * Portal outing sub-routes — employee outdoor sign-in/out records.
 * Endpoints:
 *   POST   /api/portal/outing-record
 *   GET    /api/portal/outing-records/:employeeId
 *   GET    /api/outing-records          (admin — all records)
 *
 * Employee-facing endpoints verify caller identity (Task #56).
 * Uses uniform response helpers (Task #79).
 */
import { type Express } from "express";
import { type Server } from "http";
import { db } from "../../db";
import { outingRecords } from "../../../shared/schema";
import { eq, desc } from "drizzle-orm";
import { portalService } from "./portal.service";
import { ok, created, fail, badRequest } from "../../shared/http/response";

function extractLineUserId(req: import("express").Request): string | undefined {
  return (req.header("x-line-user-id") as string | undefined) ??
    (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
}

export function mountPortalOutingRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/portal/outing-record", async (req, res) => {
    try {
      const { employeeId, outType, destination, note, latitude, longitude, accuracy, imageUrl } = req.body;

      if (!employeeId || !outType || latitude == null || longitude == null) {
        return badRequest(res, "缺少必要欄位");
      }
      if (!["out", "return"].includes(outType)) {
        return badRequest(res, "outType 必須為 out 或 return");
      }
      if (outType === "out" && !destination?.trim()) {
        return badRequest(res, "外出簽到需填寫地點/事由");
      }

      const auth = await portalService.verifyCaller(Number(employeeId), extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });

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

      created(res, record);
    } catch (err: any) {
      console.error("Outing record create error:", err);
      fail(res, 500, err.message);
    }
  });

  app.get("/api/portal/outing-records/:employeeId", async (req, res) => {
    try {
      const employeeId = Number(req.params.employeeId);
      if (isNaN(employeeId)) return badRequest(res, "無效的員工 ID");

      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });

      ok(res, await db
        .select()
        .from(outingRecords)
        .where(eq(outingRecords.employeeId, employeeId))
        .orderBy(desc(outingRecords.createdAt)));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/outing-records", async (_req, res) => {
    try {
      ok(res, await db.select().from(outingRecords).orderBy(desc(outingRecords.createdAt)));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
