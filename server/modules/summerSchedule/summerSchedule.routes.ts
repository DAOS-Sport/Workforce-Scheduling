import { type Express } from "express";
import { type Server } from "http";
import { summerScheduleService } from "./summerSchedule.service";
import {
  getMySummerAvailability,
  saveMySummerAvailability,
  listSummerAvailability,
  deleteSummerAvailability,
} from "./summerAvailability.service";
import { ok, fail } from "../../shared/http/response";
import { requireAdmin } from "../../shared/middleware/requireAdmin";
import { requireInternalToken } from "../internal/internal.auth";

export function mountSummerScheduleRoutes(_httpServer: Server, app: Express): void {
  // 員工選擇：後台暑假排班頁使用，必須登入管理後台
  // 注意：使用 /api/admin/ 前綴避免 Express 5 路由問題
  app.get("/api/admin/summer-employees", requireAdmin, async (_req, res) => {
    try {
      const data = await summerScheduleService.getEmployeesForSchedule();
      res.status(200).json(data);
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // 報名人數：後台暑假排班頁使用，API key 只在後端
  app.get("/api/schedule/enrollment-counts", requireAdmin, async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string, 10) || 1;
      ok(res, await summerScheduleService.getEnrollmentCounts(weekNo));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // 排班草稿讀取
  app.get("/api/admin/schedule-assignments", requireAdmin, async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string, 10) || 1;
      const data = await summerScheduleService.getScheduleAssignments(weekNo);
      ok(res, data ?? { version: "v40", weekNo, rawEntries: [], assignments: [], shifts: [] });
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // 排班草稿儲存。body 帶 expectedUpdatedAt（上次讀到或存到的 updatedAt）時做版本比對，版本不符回 409。
  app.post("/api/admin/schedule-assignments", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.saveScheduleAssignments(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message, err.extra);
    }
  });

  // 手動課程讀取
  app.get("/api/admin/manual-schedule-courses", requireAdmin, async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string, 10) || 1;
      ok(res, await summerScheduleService.getManualCourses(weekNo));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // 手動課程新增（接受 {items:[...]} 或單筆物件）。帶 requestId 時，同一個 requestId 重送只新增一次。
  app.post("/api/admin/manual-schedule-courses", requireAdmin, async (req, res) => {
    try {
      const items: any[] = Array.isArray(req.body.items) ? req.body.items : [req.body];
      const rows = await summerScheduleService.createManualCourses(items, req.body?.requestId);
      ok(res, { items: rows });
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // 手動課程修改
  app.patch("/api/admin/manual-schedule-courses/:id", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.updateManualCourse(parseInt(req.params.id as string, 10), req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // 手動課程刪除
  app.delete("/api/admin/manual-schedule-courses/:id", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.deleteManualCourse(parseInt(req.params.id as string, 10)));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  /**
   * 從 Google 試算表匯入補習班課程。
   *
   * 走 requireInternalToken（吃 x-api-key / Authorization: Bearer / x-internal-token）
   * 而不是 requireAdmin —— 呼叫端是試算表的 Apps Script，沒有瀏覽器 session。
   * 這條路已經在用了：試算表那支 importCourseEnrollmentCounts 就是用 x-api-key
   * 反方向從報名系統拉資料，這裡只是把同一個模式倒過來。
   *
   * 刻意不掛在 /api/internal 底下：internal.routes.ts 結尾有 app.use("/api/internal", 404)
   * 的 catch-all，掛過去就得依賴模組掛載順序才會生效 —— 那是會被日後重排順序
   * 靜默弄壞的相依。放在 /api/schedule 下沒有這個問題。
   *
   * body: {
   *   dryRun?: boolean,           // true = 只回報會怎麼做，不寫入
   *   rows: [{
   *     cramName, sportType,      // 「補習班名稱」「項目類別」→ 課名由程式組
   *     date, startTime, endTime,
   *     registeredCount, requiredCoaches,
   *     coachNames,               // 「排班人員」，字串或陣列
   *     venueName?
   *   }]
   * }
   */
  app.post("/api/schedule/cram-courses/import", requireInternalToken, async (req, res) => {
    try {
      ok(res, await summerScheduleService.importCramCourses(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // 取得已發布的救生/櫃台班次（供後台時間軸同步顯示）
  app.get("/api/admin/summer-schedule/duty-shifts", requireAdmin, async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string, 10) || 1;
      ok(res, await summerScheduleService.getPublishedDutyShifts(weekNo));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // 發布到員工前台 shifts
  // 只送 {weekNo}：服務端讀取已儲存的草稿發布（DB 驅動，republish 永遠一致）。請求裡的 shifts 一律忽略。
  app.post("/api/admin/summer-schedule/publish-shifts", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.publishShifts(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message, err.extra);
    }
  });

  // ── 暑假可排班時段 ─────────────────────────────────────────

  // Portal: 取得本人本週填報
  app.get("/api/portal/summer-availability/:weekNo", async (req, res) => {
    try {
      const lineId = req.header("x-line-user-id") ?? (req.query.lineUserId as string) ?? "";
      ok(res, await getMySummerAvailability(lineId, req.params.weekNo));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // Portal: 新增或更新本人填報
  app.post("/api/portal/summer-availability", async (req, res) => {
    try {
      const lineId = req.header("x-line-user-id") ?? (req.query.lineUserId as string) ?? "";
      ok(res, await saveMySummerAvailability(lineId, req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // Admin: 取得某週所有員工填報（含「未填報」員工）
  app.get("/api/admin/summer-availability", requireAdmin, async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string, 10) || 1;
      ok(res, await listSummerAvailability(weekNo));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // Admin: 刪除某位員工某週的暑假可排班填報；員工仍會在列表中以「未填報」呈現
  app.delete("/api/admin/summer-availability/:employeeId/:weekNo", requireAdmin, async (req, res) => {
    try {
      ok(res, await deleteSummerAvailability(String(req.params.employeeId), String(req.params.weekNo)));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
