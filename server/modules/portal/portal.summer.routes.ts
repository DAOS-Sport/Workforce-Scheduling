import { type Express, type Request } from "express";
import { type Server } from "http";
import { summerScheduleService } from "../summerSchedule/summerSchedule.service";
import { ok, fail } from "../../shared/http/response";

function extractLineUserId(req: Request): string | undefined {
  return (req.header("x-line-user-id") as string | undefined) ??
    (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
}

export function mountPortalSummerRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/my-summer-shifts/:weekNo", async (req, res) => {
    try {
      const weekNo = parseInt(req.params.weekNo);
      const lineId = extractLineUserId(req);
      if (!lineId) return fail(res, 401, "需要 LINE 身份識別", { code: "UNAUTHENTICATED" });
      ok(res, await summerScheduleService.getMySummerShifts(weekNo, lineId));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
