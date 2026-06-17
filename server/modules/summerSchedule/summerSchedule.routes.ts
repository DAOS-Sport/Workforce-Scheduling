import { type Express, type Request, type Response } from "express";
import { type Server } from "http";
import { summerScheduleService } from "./summerSchedule.service";
import { ok, fail } from "../../shared/http/response";

export function mountSummerScheduleRoutes(_httpServer: Server, app: Express): void {
  // 員工選擇
  app.get("/api/employees/for-schedule", async (_req, res) => {
    try {
      ok(res, await summerScheduleService.getEmployeesForSchedule());
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // 報名人數
  app.get("/api/schedule/enrollment-counts", async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string) || 1;
      ok(res, await summerScheduleService.getEnrollmentCounts(weekNo));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // 排班草稿
  app.get("/api/admin/schedule-assignments", async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string) || 1;
      const data = await summerScheduleService.getScheduleAssignments(weekNo);
      ok(res, data ?? { version: "v40", weekNo, rawEntries: [], assignments: [], shifts: [] });
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/admin/schedule-assignments", async (req, res) => {
    try {
      ok(res, await summerScheduleService.saveScheduleAssignments(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  // 手動課程
  app.get("/api/admin/manual-schedule-courses", async (req, res) => {
    try {
      const weekNo = parseInt(req.query.weekNo as string) || 1;
      ok(res, await summerScheduleService.getManualCourses(weekNo));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/admin/manual-schedule-courses", async (req, res) => {
    try {
      ok(res, await summerScheduleService.createManualCourse(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.patch("/api/admin/manual-schedule-courses/:id", async (req, res) => {
    try {
      ok(res, await summerScheduleService.updateManualCourse(parseInt(req.params.id), req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });

  app.delete("/api/admin/manual-schedule-courses/:id", async (req, res) => {
    try {
      ok(res, await summerScheduleService.deleteManualCourse(parseInt(req.params.id)));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  // 發布到員工前台
  app.post("/api/admin/summer-schedule/publish-shifts", async (req, res) => {
    try {
      ok(res, await summerScheduleService.publishShifts(req.body));
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
}
