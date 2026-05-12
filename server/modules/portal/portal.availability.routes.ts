/**
 * Portal availability sub-routes — employee shift availability (排班意願).
 * Endpoints:
 *   GET    /api/portal/my-availabilities/:employeeId/:yearMonth
 *   POST   /api/portal/availability
 *   DELETE /api/portal/availability/:id
 *   GET    /api/portal/availability-window  (public — no auth needed)
 */
import { type Express } from "express";
import { type Server } from "http";
import { portalService } from "./portal.service";
import { availabilityRepository } from "../availability/availability.repository";
import { storage } from "../../storage";
import { ok, created, fail, badRequest, notFound } from "../../shared/http/response";

function extractLineUserId(req: import("express").Request): string | undefined {
  return (req.header("x-line-user-id") as string | undefined) ??
    (typeof req.query.lineUserId === "string" ? req.query.lineUserId : undefined);
}

interface AvailWindow { targetYearMonth: string; openFrom: string; openUntil: string; }

/** Returns today's date string (yyyy-MM-dd) in Asia/Taipei timezone. */
function todayTaipei(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

/** Returns ISO week bounds (Mon–Sun) for a given date string (yyyy-MM-dd). */
function getIsoWeekBounds(dateStr: string): { weekStart: string; weekEnd: string } {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { weekStart: fmt(mon), weekEnd: fmt(sun) };
}

/** Load and validate the current availability window. Returns error string if closed, null if open. */
async function checkWindowOpen(targetDate?: string): Promise<string | null> {
  const cfg = await storage.getSystemConfig("availability_window");
  if (!cfg?.value) return "管理員尚未設定意願填寫開放時間";
  let win: AvailWindow;
  try { win = JSON.parse(cfg.value) as AvailWindow; } catch { return "意願填寫設定格式錯誤"; }
  if (!/^\d{4}-\d{2}$/.test(win.targetYearMonth) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(win.openFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(win.openUntil)) {
    return "意願填寫設定格式錯誤";
  }
  const today = todayTaipei();
  if (today < win.openFrom || today > win.openUntil) return "目前不在開放填寫期間";
  if (targetDate) {
    const dateMonth = targetDate.slice(0, 7); // yyyy-MM
    if (dateMonth !== win.targetYearMonth) {
      return `填寫日期須屬於開放月份（${win.targetYearMonth}）`;
    }
  }
  return null;
}

export function mountPortalAvailabilityRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/portal/availability-window", async (_req, res) => {
    try {
      const cfg = await storage.getSystemConfig("availability_window");
      if (!cfg) return ok(res, null);
      try {
        ok(res, JSON.parse(cfg.value));
      } catch {
        ok(res, null);
      }
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.get("/api/portal/my-availabilities/:employeeId/:yearMonth", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      if (isNaN(employeeId)) return badRequest(res, "無效的員工 ID");
      const auth = await portalService.verifyCaller(employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      const { yearMonth } = req.params;
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) return badRequest(res, "yearMonth 格式須為 YYYY-MM");
      ok(res, await availabilityRepository.getByEmployeeAndYearMonth(employeeId, yearMonth));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.post("/api/portal/availability", async (req, res) => {
    try {
      const { employeeId, date, startTime, endTime, note, entryType } = req.body;
      const isOffRequest = entryType === "off_request";
      if (!employeeId || !date) return badRequest(res, "缺少必要欄位");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, "date 格式須為 YYYY-MM-DD");
      if (!isOffRequest) {
        if (!startTime || !endTime) return badRequest(res, "缺少必要欄位");
        if (!/^\d{2}:\d{2}(:\d{2})?$/.test(startTime) || !/^\d{2}:\d{2}(:\d{2})?$/.test(endTime)) {
          return badRequest(res, "時間格式須為 HH:MM");
        }
        if (startTime >= endTime) return badRequest(res, "結束時間必須晚於開始時間");
      }
      const windowErr = await checkWindowOpen(date);
      if (windowErr) return fail(res, 403, windowErr);
      const auth = await portalService.verifyCaller(Number(employeeId), extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      const emp = await storage.getEmployee(Number(employeeId));
      if (!emp) return notFound(res, "找不到員工資料");
      const empType = emp.employmentType ?? "full_time";
      if (isOffRequest && empType !== "full_time") {
        return badRequest(res, "兼職員工無法填寫休假意願，請選擇可上班時段");
      }
      if (!isOffRequest && empType === "full_time") {
        return badRequest(res, "正職員工僅可填寫休假意願，無法選擇時段");
      }
      if (isOffRequest) {
        const { weekStart, weekEnd } = getIsoWeekBounds(date);
        const weekCount = await availabilityRepository.countOffRequestsInWeek(Number(employeeId), weekStart, weekEnd);
        if (weekCount >= 2) {
          return badRequest(res, "每週最多標記 2 天休假意願");
        }
      }
      if (!isOffRequest && emp.regionId) {
        const regionVenues = await storage.getVenuesByRegion(emp.regionId);
        const operated = regionVenues.filter((v) => v.openTime && v.closeTime);
        if (operated.length > 0) {
          const regionOpen = operated.map((v) => v.openTime!).sort()[0];
          const regionClose = operated.map((v) => v.closeTime!).sort().reverse()[0];
          const st = (startTime as string).slice(0, 5);
          const et = (endTime as string).slice(0, 5);
          if (st < regionOpen || et > regionClose) {
            return badRequest(res, `時段超出場館開放時間（${regionOpen}–${regionClose}）`);
          }
        }
      }
      const leaveType = isOffRequest ? (note?.trim() || null) : null;
      const row = await availabilityRepository.create({
        employeeId: Number(employeeId),
        date,
        entryType: isOffRequest ? "off_request" : "available",
        startTime: isOffRequest ? null : startTime,
        endTime: isOffRequest ? null : endTime,
        note: isOffRequest ? leaveType : (note?.trim() || null),
      });
      created(res, row);
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });

  app.delete("/api/portal/availability/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return badRequest(res, "無效的 ID");
      const row = await availabilityRepository.getById(id);
      if (!row) return notFound(res, "找不到此意願紀錄");
      const windowErr = await checkWindowOpen(row.date);
      if (windowErr) return fail(res, 403, windowErr);
      const auth = await portalService.verifyCaller(row.employeeId, extractLineUserId(req));
      if (!auth.ok) return fail(res, auth.status, auth.message ?? "未授權", { code: auth.code });
      await availabilityRepository.delete(id);
      ok(res, { success: true });
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
