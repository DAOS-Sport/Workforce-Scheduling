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
import { portalService } from "./portal.service";
import { createOutingRecord, listEmployeeOutingRecords, listAllOutingRecords } from "./portal.outing.service";
import { ok, created, fail, badRequest } from "../../shared/http/response";

function extractLineUserId(req: import("express").Request): string | undefined {
  return (req.header("x-line-user-id") as string | undefined) ??
    (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
}

export function mountPortalOutingRoutes(_httpServer: Server, app: Express): void {
  app.post("/api/portal/outing-record", async (req, res) => {
    try {
      const { employeeId, outType, destination, latitude, longitude } = req.body;

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

      created(res, await createOutingRecord(req.body));
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

      ok(res, await listEmployeeOutingRecords(employeeId));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/outing-records", async (_req, res) => {
    try {
      ok(res, await listAllOutingRecords());
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
