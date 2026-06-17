import { type Express } from "express";
import { type Server } from "http";
import { summerScheduleService } from "./summerSchedule.service";
import { ok, fail } from "../../shared/http/response";
import { requireAdmin } from "../../shared/middleware/requireAdmin";

export function mountSummerScheduleRoutes(_httpServer: Server, app: Express): void {
  // 員工選擇：後台暑假排班頁使用，必須登入管理後台
  app.get("/api/employees/for-schedule", requireAdmin, async (_req, res) => {
    try {
      ok(res, await summerScheduleService.getEmployeesForSchedule());
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

  // 手動課程新增
  app.post("/api/admin/manual-schedule-courses", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.createManualCourse(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // 手動課程修改
  app.patch("/api/admin/manual-schedule-courses/:id", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.updateManualCourse(parseInt(req.params.id, 10), req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // 手動課程刪除
  app.delete("/api/admin/manual-schedule-courses/:id", requireAdmin, async (req, res) => {
    try {
      ok(res, await summerScheduleService.deleteManualCourse(parseInt(req.params.id, 10)));
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
}
