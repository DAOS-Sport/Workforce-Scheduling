import { type Express } from "express";
import { type Server } from "http";
import { summerScheduleService } from "./summerSchedule.service";
import { summerAvailabilityRepository } from "./summerAvailability.repository";
import { ok, fail } from "../../shared/http/response";
import { requireAdmin } from "../../shared/middleware/requireAdmin";
import { storage } from "../../storage";

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

  // 排班草稿儲存
  app.post("/api/admin/schedule-assignments", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.saveScheduleAssignments(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
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

  // 手動課程新增（接受 {items:[...]} 或單筆物件）
  app.post("/api/admin/manual-schedule-courses", requireAdmin, async (req, res) => {
    try {
      const items: any[] = Array.isArray(req.body.items) ? req.body.items : [req.body];
      const rows = await summerScheduleService.createManualCourses(items);
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

  // 發布到員工前台 shifts
  app.post("/api/admin/summer-schedule/publish-shifts", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.publishShifts(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // ── 暑假可排班時段 ─────────────────────────────────────────

  // Portal: 取得本人本週填報
  app.get("/api/portal/summer-availability/:weekNo", async (req, res) => {
    try {
      const lineId = req.header("x-line-user-id") ?? (req.query.lineUserId as string) ?? "";
      if (!lineId) return fail(res, 401, "需要 LINE 身份");
      const employee = await storage.getEmployeeByLineId(lineId);
      if (!employee) return fail(res, 404, "找不到員工資料");
      const weekNo = parseInt(req.params.weekNo, 10);
      if (!weekNo || weekNo < 1 || weekNo > 9) return fail(res, 400, "weekNo 只允許 1-9");
      const record = await summerAvailabilityRepository.getByEmployeeAndWeek(employee.id, weekNo);
      if (!record) return res.status(404).json({ message: "尚無填報資料" });
      ok(res, record);
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // Portal: 新增或更新本人填報
  app.post("/api/portal/summer-availability", async (req, res) => {
    try {
      const lineId = req.header("x-line-user-id") ?? (req.query.lineUserId as string) ?? "";
      if (!lineId) return fail(res, 401, "需要 LINE 身份");
      const employee = await storage.getEmployeeByLineId(lineId);
      if (!employee) return fail(res, 404, "找不到員工資料");
      const { weekNo, venueNames = [], weekdayDays = [], weekdaySlots = [], satSlots = [], sunSlots = [], notes } = req.body;
      if (!weekNo || weekNo < 1 || weekNo > 9) return fail(res, 400, "weekNo 只允許 1-9");
      const record = await summerAvailabilityRepository.upsert({
        employeeId: employee.id,
        weekNo,
        venueNames,
        weekdayDays,
        weekdaySlots,
        satSlots,
        sunSlots,
        notes: notes || null,
      });
      ok(res, record);
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // Admin: 取得某週所有員工填報（含「未填報」員工）
  app.get("/api/admin/summer-availability", requireAdmin, async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string, 10) || 1;
      // 1. 取得暑假排班員工清單（與前台同一份資料）；回傳值為 { items: [] }
      const summerEmpsResult = await summerScheduleService.getEmployeesForSchedule();
      const summerEmps: { id: number; name: string }[] = Array.isArray(summerEmpsResult)
        ? summerEmpsResult
        : (summerEmpsResult as any)?.items ?? [];
      // 2. 取得本週已填報紀錄
      const rows = await summerAvailabilityRepository.getAllByWeek(weekNo);
      const submittedMap = new Map(rows.map((r) => [r.employeeId, r]));
      // 3. 組合：已填報員工展開欄位，未填報員工補 null + submitted:false
      const items = summerEmps.map((emp: { id: number; name: string }) => {
        const record = submittedMap.get(emp.id);
        if (record) {
          return {
            ...record,
            employeeName: emp.name,
            submitted: true,
          };
        }
        return {
          id: null,
          employeeId: emp.id,
          employeeName: emp.name,
          weekNo,
          venueNames: [],
          weekdayDays: [],
          weekdaySlots: [],
          satSlots: [],
          sunSlots: [],
          notes: null,
          submitted: false,
          submittedAt: null,
          updatedAt: null,
        };
      });
      ok(res, { items });
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
