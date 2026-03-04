import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { REGIONS_DATA, VENUES_DATA, insertEmployeeSchema, insertVenueSchema, insertShiftSchema, insertScheduleSlotSchema, insertVenueShiftTemplateSchema, insertGuidelineSchema, insertGuidelineAckSchema, type InsertAttendanceRecord, type ShiftValidationError } from "@shared/schema";
import { z } from "zod";
import { validateAllRules } from "./labor-validation";
import { syncFromRagic, syncVenuesFromRagic } from "./ragic";

const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假"];
import { verifyLineSignature, verifyForwardedRequest, handleLineWebhook, processClockIn, sendShiftReminders } from "./line-webhook";
import multer from "multer";
import * as XLSX from "xlsx";
import nodemailer from "nodemailer";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.use("/api/anomaly-report", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/anomaly-reports", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/notification-recipients", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use("/api/test-email", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.post("/api/admin/login", async (req, res) => {
    try {
      const { password } = req.body;
      if (!password) return res.status(400).json({ message: "請輸入密碼" });

      const ADMIN_PASSWORD = "<removed>";
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "密碼錯誤" });
      }

      const allEmployees = await storage.getAllEmployees();
      const admin = allEmployees.find(e => e.isAdmin);

      req.session.adminId = admin?.id || 1;
      req.session.adminName = admin?.name || "管理員";
      req.session.adminLineId = "";

      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ message: "登入儲存失敗" });
        }
        res.json({ id: req.session.adminId, name: req.session.adminName });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/me", (req, res) => {
    if (req.session.adminId) {
      res.json({ id: req.session.adminId, name: req.session.adminName });
    } else {
      res.status(401).json({ message: "未登入" });
    }
  });

  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  function requireAdmin(req: Request, res: Response, next: Function) {
    if (req.session.adminId) return next();
    return res.status(401).json({ message: "請先登入管理後台" });
  }

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    const openPrefixes = [
      "/api/admin/",
      "/api/portal/",
      "/api/liff/",
      "/api/line/",
      "/api/anomaly-report",
    ];
    if (openPrefixes.some(p => req.path.startsWith(p))) return next();
    requireAdmin(req, res, next);
  });

  app.get("/api/regions", async (_req, res) => {
    const regions = await storage.getRegions();
    res.json(regions);
  });

  app.get("/api/employees-all", async (_req, res) => {
    const allEmployees = await storage.getAllEmployees();
    const DISPLAY_ROLES = ["救生", "守望", "櫃台", "教練", "主管職"];
    const filtered = allEmployees.filter(
      (e) => DISPLAY_ROLES.includes(e.role) && e.status === "active"
    );
    res.json(filtered);
  });

  app.get("/api/employees/:regionCode", async (req, res) => {
    const { regionCode } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const allEmployees = await storage.getEmployeesByRegion(region.id);
    const DISPLAY_ROLES = ["救生", "守望", "櫃台", "教練", "主管職"];
    const employees = allEmployees.filter(
      (e) => DISPLAY_ROLES.includes(e.role) && e.status === "active"
    );
    res.json(employees);
  });

  app.post("/api/employees", async (req, res) => {
    try {
      const parsed = insertEmployeeSchema.parse(req.body);
      const employee = await storage.createEmployee(parsed);
      res.json(employee);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤：" + err.errors.map((e: any) => e.message).join(", ") });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/employees/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertEmployeeSchema.partial().parse(req.body);
      const employee = await storage.updateEmployee(id, partial);
      if (!employee) return res.status(404).json({ message: "Employee not found" });
      res.json(employee);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/employees/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteEmployee(id);
      if (!deleted) return res.status(404).json({ message: "Employee not found" });
      res.json({ message: "Employee deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/venues/:regionCode", async (req, res) => {
    const { regionCode } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const venues = await storage.getVenuesByRegion(region.id);
    res.json(venues);
  });

  app.post("/api/venues", async (req, res) => {
    try {
      const parsed = insertVenueSchema.parse(req.body);
      const venue = await storage.createVenue(parsed);
      res.json(venue);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/venues/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertVenueSchema.partial().parse(req.body);
      const venue = await storage.updateVenue(id, partial);
      if (!venue) return res.status(404).json({ message: "Venue not found" });
      res.json(venue);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/shifts/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const shifts = await storage.getShiftsByRegionAndDateRange(region.id, startDate, endDate);
    res.json(shifts);
  });

  app.post("/api/shifts", async (req, res) => {
    try {
      const parsed = insertShiftSchema.parse(req.body);

      const employee = await storage.getEmployee(parsed.employeeId);
      if (!employee || employee.status !== "active") {
        return res.status(400).json({ message: "該員工非在職狀態，無法排班" });
      }

      if (parsed.isDispatch && !parsed.dispatchCompany) {
        return res.status(400).json({ message: "派遣模式須填寫派遣公司" });
      }

      const isLeave = LEAVE_TYPES.includes(parsed.role);
      let warnings: ShiftValidationError[] = [];

      if (!isLeave) {
        const existingShifts = await storage.getShiftsByEmployee(parsed.employeeId);
        const errors = validateAllRules(
          parsed.employeeId,
          parsed.date,
          parsed.startTime,
          parsed.endTime,
          existingShifts
        );

        const blocking = errors.filter((e: ShiftValidationError) => e.type === "seven_day_rest" || e.type === "daily_12h");
        if (blocking.length > 0) {
          return res.status(400).json({ message: blocking[0].message });
        }
        warnings = errors.filter((e: ShiftValidationError) => e.type === "rest_11h");
      }

      const shift = await storage.createShift(parsed);
      res.json({ ...shift, warnings });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "排班資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/shifts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getShift(id);
      if (!existing) return res.status(404).json({ message: "Shift not found" });

      const partial = insertShiftSchema.partial().parse(req.body);
      const employeeId = partial.employeeId || existing.employeeId;
      const date = partial.date || existing.date;
      const startTime = partial.startTime || existing.startTime;
      const endTime = partial.endTime || existing.endTime;

      const employee = await storage.getEmployee(employeeId);
      if (!employee || employee.status !== "active") {
        return res.status(400).json({ message: "該員工非在職狀態，無法排班" });
      }

      const role = partial.role || existing.role;
      const isLeave = LEAVE_TYPES.includes(role);
      let warnings: ShiftValidationError[] = [];

      if (!isLeave) {
        const existingShifts = await storage.getShiftsByEmployee(employeeId);
        const errors = validateAllRules(employeeId, date, startTime, endTime, existingShifts, id);
        const blocking = errors.filter((e: ShiftValidationError) => e.type === "seven_day_rest" || e.type === "daily_12h");
        if (blocking.length > 0) {
          return res.status(400).json({ message: blocking[0].message });
        }
        warnings = errors.filter((e: ShiftValidationError) => e.type === "rest_11h");
      }

      const shift = await storage.updateShift(id, partial);
      res.json({ ...shift, warnings });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "排班資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/shifts/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteShift(id);
    if (!deleted) return res.status(404).json({ message: "Shift not found" });
    res.json({ success: true });
  });

  app.post("/api/shifts/batch-delete", async (req, res) => {
    try {
      const { employeeId, venueId, startTime, endTime, role, targetDates } = req.body;
      const empId = Number(employeeId);
      if (!empId || !Array.isArray(targetDates) || targetDates.length === 0) {
        return res.status(400).json({ message: "employeeId and targetDates are required" });
      }
      let deletedCount = 0;
      for (const date of targetDates) {
        const shifts = await storage.getShiftsByEmployeeAndDateRange(empId, date, date);
        const matching = shifts.filter(s =>
          (!venueId || s.venueId === Number(venueId)) &&
          (!startTime || s.startTime === startTime) &&
          (!endTime || s.endTime === endTime) &&
          (!role || s.role === role)
        );
        for (const s of matching) {
          await storage.deleteShift(s.id);
          deletedCount++;
        }
      }
      res.json({ success: true, deletedCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/shifts/batch", async (req, res) => {
    try {
      const { employeeId, venueId, startTime, endTime, role, isDispatch, targetDates } = req.body;
      if (!employeeId || !venueId || !startTime || !endTime || !role || !Array.isArray(targetDates) || targetDates.length === 0) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }

      const employee = await storage.getEmployee(employeeId);
      if (!employee || employee.status !== "active") {
        return res.status(400).json({ message: "該員工非在職狀態，無法排班" });
      }

      const isLeave = LEAVE_TYPES.includes(role);
      const existingShifts = isLeave ? [] : await storage.getShiftsByEmployee(employeeId);
      const results: any[] = [];
      const errors: string[] = [];

      for (const date of targetDates) {
        if (!isLeave) {
          const dayErrors = validateAllRules(employeeId, date, startTime, endTime, existingShifts);
          const blocking = dayErrors.filter((e: ShiftValidationError) => e.type === "seven_day_rest" || e.type === "daily_12h");
          if (blocking.length > 0) {
            errors.push(`${date}: ${blocking[0].message}`);
            continue;
          }
        }
        const shift = await storage.createShift({
          employeeId,
          venueId: parseInt(venueId),
          date,
          startTime,
          endTime,
          role,
          isDispatch: isDispatch || false,
        });
        if (!isLeave) existingShifts.push(shift as any);
        results.push(shift);
      }

      res.json({ created: results.length, errors, shifts: results });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/shifts/copy-from-previous", async (req, res) => {
    try {
      const { regionCode, targetYear, targetMonth } = req.body;
      if (!regionCode || !targetYear || !targetMonth) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      const region = await storage.getRegionByCode(regionCode);
      if (!region) return res.status(404).json({ message: "找不到區域" });

      const prevDate = new Date(targetYear, targetMonth - 2, 1);
      const prevYear = prevDate.getFullYear();
      const prevMonth = prevDate.getMonth() + 1;
      const prevStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
      const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
      const prevEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(prevLastDay).padStart(2, "0")}`;

      const targetStart = `${targetYear}-${String(targetMonth).padStart(2, "0")}-01`;
      const targetLastDay = new Date(targetYear, targetMonth, 0).getDate();
      const targetEnd = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetLastDay).padStart(2, "0")}`;

      const existingTargetShifts = await storage.getShiftsByRegionAndDateRange(region.id, targetStart, targetEnd);
      if (existingTargetShifts.length > 0) {
        return res.status(400).json({ message: "目標月份已有排班資料，無法覆蓋" });
      }

      const prevShifts = await storage.getShiftsByRegionAndDateRange(region.id, prevStart, prevEnd);
      if (prevShifts.length === 0) {
        return res.status(400).json({ message: "上個月無排班資料可複製" });
      }

      const results: any[] = [];
      const errors: string[] = [];

      for (const s of prevShifts) {
        const dateParts = s.date.split("-");
        const dayOfMonth = parseInt(dateParts[2], 10);
        if (dayOfMonth > targetLastDay) {
          continue;
        }
        const newDate = `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;

        try {
          const shift = await storage.createShift({
            employeeId: s.employeeId,
            venueId: s.venueId,
            date: newDate,
            startTime: s.startTime,
            endTime: s.endTime,
            role: s.role,
            isDispatch: s.isDispatch,
            dispatchCompany: s.dispatchCompany,
            dispatchName: s.dispatchName,
            dispatchPhone: s.dispatchPhone,
          });
          results.push(shift);
        } catch (err: any) {
          errors.push(`${newDate}: ${err.message}`);
        }
      }

      res.json({ created: results.length, errors, message: `已從${prevMonth}月複製 ${results.length} 筆班表` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dispatch-shifts/:regionCode/:startDate/:endDate", async (req, res) => {
    try {
      const { regionCode, startDate, endDate } = req.params;
      const region = await storage.getRegionByCode(regionCode);
      if (!region) return res.json([]);
      const records = await storage.getDispatchShifts(region.id, startDate, endDate);
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/dispatch-shifts", async (req, res) => {
    try {
      const { regionCode, venueId, date, startTime, endTime, dispatchName, dispatchCompany, dispatchPhone, role, notes } = req.body;
      if (!regionCode || !date || !startTime || !endTime || !dispatchName) {
        return res.status(400).json({ message: "缺少必要欄位（區域、日期、時間、派遣人員姓名）" });
      }
      const region = await storage.getRegionByCode(regionCode);
      if (!region) return res.status(404).json({ message: "找不到區域" });
      const record = await storage.createDispatchShift({
        regionId: region.id,
        venueId: venueId || null,
        date,
        startTime,
        endTime,
        dispatchName,
        dispatchCompany: dispatchCompany || null,
        dispatchPhone: dispatchPhone || null,
        role: role || "救生",
        notes: notes || null,
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/dispatch-shifts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getDispatchShift(id);
      if (!existing) return res.status(404).json({ message: "找不到派遣班次" });
      const { regionCode, ...rest } = req.body;
      const updateData: Record<string, any> = {};
      if (regionCode) {
        const region = await storage.getRegionByCode(regionCode);
        if (!region) return res.status(404).json({ message: "找不到區域" });
        updateData.regionId = region.id;
      }
      const allowedFields = ["venueId", "date", "startTime", "endTime", "dispatchName", "dispatchCompany", "dispatchPhone", "role", "notes"];
      for (const field of allowedFields) {
        if (rest[field] !== undefined) updateData[field] = rest[field];
      }
      const updated = await storage.updateDispatchShift(id, updateData);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/dispatch-shifts/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDispatchShift(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/schedule-slots/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const realSlots = await storage.getScheduleSlotsByRegionAndDateRange(region.id, startDate, endDate);

    const regionVenues = await storage.getVenuesByRegion(region.id);

    const allTemplates: Record<number, any[]> = {};
    for (const v of regionVenues) {
      const tpls = await storage.getVenueShiftTemplates(v.id);
      if (tpls.length > 0) allTemplates[v.id] = tpls;
    }

    const realSlotDates = new Set<string>();
    realSlots.forEach((s) => realSlotDates.add(`${s.venueId}-${s.date}`));

    const virtualSlots: any[] = [];
    let virtualId = -1;

    const start = new Date(startDate + "T00:00:00");
    const end = new Date(endDate + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;
      const dayOfWeek = d.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dayType = isWeekend ? "weekend" : "weekday";

      for (const venue of regionVenues) {
        const key = `${venue.id}-${dateStr}`;
        if (realSlotDates.has(key)) continue;

        const tpls = allTemplates[venue.id];
        if (!tpls) continue;

        const matched = tpls.filter((t) => {
          const tDayType = t.dayType.toLowerCase();
          if (isWeekend) return tDayType === "weekend" || tDayType === "假日";
          return tDayType === "weekday" || tDayType === "平日";
        });
        for (const t of matched) {
          virtualSlots.push({
            id: virtualId--,
            venueId: venue.id,
            date: dateStr,
            startTime: t.startTime,
            endTime: t.endTime,
            role: t.role,
            requiredCount: t.requiredCount,
            _fromTemplate: true,
          });
        }
      }
    }

    res.json([...realSlots, ...virtualSlots]);
  });

  app.post("/api/schedule-slots/materialize", async (req, res) => {
    try {
      const { venueId, date, excludeTemplateIds } = req.body;
      if (!venueId || !date) return res.status(400).json({ message: "Missing venueId or date" });

      const venue = await storage.getVenue(venueId);
      if (!venue) return res.status(404).json({ message: "Venue not found" });
      const existingSlots = await storage.getScheduleSlotsByRegionAndDateRange(venue.regionId, date, date);
      const hasReal = existingSlots.some((s) => s.venueId === venueId);
      if (hasReal) return res.json({ message: "Already has real slots", created: 0 });

      const templates = await storage.getVenueShiftTemplates(venueId);
      const d = new Date(date + "T00:00:00");
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const matched = templates.filter((t) => {
        const dt = t.dayType.toLowerCase();
        return isWeekend ? (dt === "weekend" || dt === "假日") : (dt === "weekday" || dt === "平日");
      });

      const excludeSlots = (excludeTemplateIds || []) as Array<{startTime: string; endTime: string; role: string}>;
      const results = [];
      for (const t of matched) {
        const isExcluded = excludeSlots.some((ex: any) => 
          ex.startTime === t.startTime && ex.endTime === t.endTime && ex.role === t.role
        );
        if (isExcluded) continue;
        const slot = await storage.createScheduleSlot({
          venueId,
          date,
          startTime: t.startTime,
          endTime: t.endTime,
          role: t.role,
          requiredCount: t.requiredCount,
        });
        results.push(slot);
      }
      res.json({ created: results.length, slots: results });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/schedule-slots", async (req, res) => {
    try {
      const parsed = insertScheduleSlotSchema.parse(req.body);
      const slot = await storage.createScheduleSlot(parsed);
      res.json(slot);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/schedule-slots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertScheduleSlotSchema.partial().parse(req.body);
      const slot = await storage.updateScheduleSlot(id, partial);
      if (!slot) return res.status(404).json({ message: "Slot not found" });
      res.json(slot);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/schedule-slots/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteScheduleSlot(id);
    if (!deleted) return res.status(404).json({ message: "Slot not found" });
    res.json({ success: true });
  });

  app.post("/api/schedule-slots/batch-copy", async (req, res) => {
    try {
      const { venueId, venueIds, startTime, endTime, role, requiredCount, targetDates } = req.body;
      const resolvedVenueIds: number[] = Array.isArray(venueIds) && venueIds.length > 0 ? venueIds : (venueId ? [venueId] : []);
      if (resolvedVenueIds.length === 0 || !startTime || !endTime || !role || !requiredCount || !Array.isArray(targetDates) || targetDates.length === 0) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      const results: any[] = [];
      let skipped = 0;
      for (const vid of resolvedVenueIds) {
        for (const date of targetDates) {
          const existing = await storage.getScheduleSlotsByVenueAndDate(vid, date);
          const duplicate = existing.find(s => s.startTime === startTime && s.endTime === endTime && s.role === role);
          if (duplicate) {
            skipped++;
            continue;
          }
          const slot = await storage.createScheduleSlot({ venueId: vid, date, startTime, endTime, role, requiredCount });
          results.push(slot);
        }
      }
      res.json({ created: results.length, skipped, slots: results });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/venue-requirements/:regionCode", async (req, res) => {
    const { regionCode } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const requirements = await storage.getVenueRequirementsByRegion(region.id);
    res.json(requirements);
  });

  app.get("/api/venue-shift-templates/:venueId", async (req, res) => {
    const venueId = parseInt(req.params.venueId);
    const templates = await storage.getVenueShiftTemplates(venueId);
    res.json(templates);
  });

  app.post("/api/venue-shift-templates", async (req, res) => {
    try {
      const parsed = insertVenueShiftTemplateSchema.parse(req.body);
      const template = await storage.createVenueShiftTemplate(parsed);
      res.json(template);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/venue-shift-templates/batch/:venueId", async (req, res) => {
    try {
      const venueId = parseInt(req.params.venueId);
      const { templates } = req.body;
      if (!Array.isArray(templates)) {
        return res.status(400).json({ message: "templates must be an array" });
      }
      await storage.deleteVenueShiftTemplatesByVenue(venueId);
      const results = [];
      for (const t of templates) {
        const parsed = insertVenueShiftTemplateSchema.parse({ ...t, venueId });
        const created = await storage.createVenueShiftTemplate(parsed);
        results.push(created);
      }
      res.json(results);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/venue-shift-templates/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteVenueShiftTemplate(id);
    if (!deleted) return res.status(404).json({ message: "Template not found" });
    res.json({ success: true });
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  app.get("/api/attendance-uploads", async (_req, res) => {
    const uploads = await storage.getAttendanceUploads();
    res.json(uploads);
  });

  app.post("/api/attendance-upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "請選擇檔案" });
      }
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });

      const punchSheetName = wb.SheetNames.find((n) => n.includes("打卡紀錄"));
      if (!punchSheetName) {
        return res.status(400).json({ message: "找不到「打卡紀錄」工作表，請確認檔案格式" });
      }
      const punchSheet = wb.Sheets[punchSheetName];
      const punchData: any[][] = XLSX.utils.sheet_to_json(punchSheet, { header: 1, defval: "" });
      if (punchData.length < 2) {
        return res.status(400).json({ message: "打卡紀錄表無數據" });
      }

      const periodMatch = punchSheetName.match(/(\d{4}\.\d{2}\.\d{2})-(\d{4}\.\d{2}\.\d{2})/);
      let periodStart = "";
      let periodEnd = "";
      if (periodMatch) {
        periodStart = periodMatch[1].replace(/\./g, "-");
        periodEnd = periodMatch[2].replace(/\./g, "-");
      }

      const headers = punchData[0].map((h: any) => String(h).trim());
      const requiredHeaders = ["員工編號", "姓名", "打卡日期"];
      const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        return res.status(400).json({ message: `打卡紀錄表缺少必要欄位：${missingHeaders.join(", ")}` });
      }

      const colIdx = (name: string) => {
        const idx = headers.indexOf(name);
        return idx;
      };

      const safeGet = (row: any[], name: string): string => {
        const idx = colIdx(name);
        if (idx < 0 || idx >= row.length) return "";
        const val = row[idx];
        if (val === null || val === undefined) return "";
        return String(val).trim();
      };

      const records: InsertAttendanceRecord[] = [];
      const uploadRecord = await storage.createAttendanceUpload({
        fileName: req.file.originalname,
        periodStart: periodStart || "2026-01-01",
        periodEnd: periodEnd || "2026-01-31",
        totalRecords: 0,
      });

      const clean = (val: string) => {
        return val === "--" || val === "" ? null : val;
      };

      for (let i = 1; i < punchData.length; i++) {
        const row = punchData[i];
        const empCode = safeGet(row, "員工編號");
        const empName = safeGet(row, "姓名");
        if (!empCode || !empName) continue;

        const rawDate = safeGet(row, "打卡日期");
        if (!rawDate) continue;
        const dateStr = rawDate.replace(/\//g, "-");

        const lateVal = safeGet(row, "遲到");
        const earlyVal = safeGet(row, "早退");
        const anomalyVal = clean(safeGet(row, "出勤異常"));

        records.push({
          uploadId: uploadRecord.id,
          employeeCode: empCode,
          employeeName: empName,
          department: clean(safeGet(row, "部門")),
          date: dateStr,
          dayType: clean(safeGet(row, "日期類別")),
          shiftType: clean(safeGet(row, "班別")),
          scheduledStart: clean(safeGet(row, "表定上班時間")),
          scheduledEnd: clean(safeGet(row, "表定下班時間")),
          clockIn: clean(safeGet(row, "上班打卡時間")),
          clockOut: clean(safeGet(row, "下班打卡時間")),
          isLate: lateVal !== "" && lateVal !== "--" && lateVal !== "0" && lateVal !== "00:00:00",
          isEarlyLeave: earlyVal !== "" && earlyVal !== "--" && earlyVal !== "0" && earlyVal !== "00:00:00",
          hasAnomaly: anomalyVal !== null && anomalyVal !== "",
          anomalyNote: anomalyVal,
          leaveHours: clean(safeGet(row, "請假時數")),
          leaveType: clean(safeGet(row, "假別")),
          overtimeHours: clean(safeGet(row, "加班時數")),
          clockInMethod: clean(safeGet(row, "上班打卡方式")),
          clockInLocation: clean(safeGet(row, "上班打卡地點")),
          clockOutMethod: clean(safeGet(row, "下班打卡方式")),
          clockOutLocation: clean(safeGet(row, "下班打卡地點")),
        });
      }

      const savedRecords = await storage.createAttendanceRecords(records);

      await storage.updateAttendanceUpload(uploadRecord.id, { totalRecords: savedRecords.length });

      res.json({
        uploadId: uploadRecord.id,
        fileName: req.file.originalname,
        periodStart,
        periodEnd,
        totalRecords: savedRecords.length,
        message: `成功匯入 ${savedRecords.length} 筆打卡紀錄`,
      });
    } catch (err: any) {
      console.error("Upload error:", err);
      res.status(500).json({ message: "匯入失敗：" + err.message });
    }
  });

  app.get("/api/attendance-records/:uploadId", async (req, res) => {
    const uploadId = parseInt(req.params.uploadId);
    const records = await storage.getAttendanceRecordsByUpload(uploadId);
    res.json(records);
  });

  app.get("/api/attendance-records", async (req, res) => {
    const { startDate, endDate, employeeCodes } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ message: "請提供 startDate 和 endDate" });
    }
    const codes = employeeCodes ? String(employeeCodes).split(",") : undefined;
    const records = await storage.getAttendanceRecordsByDateRange(
      String(startDate),
      String(endDate),
      codes
    );
    res.json(records);
  });

  app.delete("/api/attendance-upload/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteAttendanceRecordsByUpload(id);
    const deleted = await storage.deleteAttendanceUpload(id);
    if (!deleted) return res.status(404).json({ message: "Upload not found" });
    res.json({ success: true });
  });

  app.get("/api/guidelines", async (req, res) => {
    const { category } = req.query;
    const items = await storage.getGuidelines(category ? String(category) : undefined);
    res.json(items);
  });

  app.get("/api/guidelines/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const item = await storage.getGuideline(id);
    if (!item) return res.status(404).json({ message: "守則未找到" });
    res.json(item);
  });

  app.post("/api/guidelines", async (req, res) => {
    try {
      const parsed = insertGuidelineSchema.parse(req.body);
      const item = await storage.createGuideline(parsed);
      res.json(item);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/guidelines/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const partial = insertGuidelineSchema.partial().parse(req.body);
      const item = await storage.updateGuideline(id, partial);
      if (!item) return res.status(404).json({ message: "守則未找到" });
      res.json(item);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/guidelines/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const deleted = await storage.deleteGuideline(id);
    if (!deleted) return res.status(404).json({ message: "守則未找到" });
    res.json({ success: true });
  });

  app.get("/api/guidelines/:id/acknowledgments", async (req, res) => {
    const id = parseInt(req.params.id);
    const acks = await storage.getGuidelineAcks(id);
    res.json(acks);
  });

  app.post("/api/guideline-ack", async (req, res) => {
    try {
      const parsed = insertGuidelineAckSchema.parse(req.body);
      const ack = await storage.createGuidelineAck(parsed);
      res.json(ack);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  const isDevMode = process.env.NODE_ENV !== "production";

  app.get("/api/portal/dev-employees", async (_req, res) => {
    if (!isDevMode) return res.status(404).json({ message: "Not found" });
    try {
      const regionIds = [1, 2, 3];
      const allEmployees: any[] = [];
      for (const rid of regionIds) {
        const emps = await storage.getEmployeesByRegion(rid);
        for (const e of emps) {
          if (e.status === "active") {
            allEmployees.push({ id: e.id, name: e.name, employeeCode: e.employeeCode, role: e.role });
          }
        }
      }
      res.json(allEmployees);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/dev-login", async (req, res) => {
    if (!isDevMode) return res.status(404).json({ message: "Not found" });
    try {
      const { employeeId } = req.body;
      if (!employeeId) return res.status(400).json({ message: "缺少員工 ID" });
      const regionIds = [1, 2, 3];
      let found: any = null;
      for (const rid of regionIds) {
        const emps = await storage.getEmployeesByRegion(rid);
        found = emps.find((e) => e.id === employeeId);
        if (found) break;
      }
      if (!found) return res.status(404).json({ message: "找不到員工" });
      if (found.status !== "active") return res.status(403).json({ message: "此帳號已停用" });
      res.json({ id: found.id, name: found.name, employeeCode: found.employeeCode, role: found.role });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/line-callback", async (req, res) => {
    try {
      const { code, redirectUri } = req.body;
      if (!code) return res.status(400).json({ message: "缺少授權碼" });

      const channelId = process.env.LINE_CHANNEL_ID;
      const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET;
      if (!channelId || !channelSecret) {
        return res.status(500).json({ message: "LINE Login 尚未設定" });
      }

      const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: channelId,
          client_secret: channelSecret,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error("LINE token error:", errText);
        return res.status(401).json({ message: "LINE 授權失敗" });
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      const profileRes = await fetch("https://api.line.me/v2/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!profileRes.ok) {
        return res.status(401).json({ message: "無法取得 LINE 個人資料" });
      }

      const profile = await profileRes.json();
      const lineUserId = profile.userId;

      const employee = await storage.getEmployeeByLineId(lineUserId);
      if (!employee) {
        return res.status(404).json({
          message: "您尚未完成系統綁定，請「截圖」並洽400官方帳號。",
          lineUserId,
          displayName: profile.displayName,
          notBound: true,
        });
      }

      if (employee.status !== "active") {
        return res.status(403).json({ message: "此帳號已停用" });
      }

      res.json({
        id: employee.id,
        name: employee.name,
        employeeCode: employee.employeeCode,
        role: employee.role,
        lineDisplayName: profile.displayName,
        lineUserId,
      });
    } catch (err: any) {
      console.error("LINE callback error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/verify", async (req, res) => {
    try {
      const { lineId } = req.body;
      if (!lineId) return res.status(400).json({ message: "缺少 LINE ID" });
      const employee = await storage.getEmployeeByLineId(lineId);
      if (!employee) return res.status(404).json({ message: "找不到此 LINE 帳號對應的員工資料" });
      if (employee.status !== "active") return res.status(403).json({ message: "此帳號已停用" });
      res.json({
        id: employee.id,
        name: employee.name,
        employeeCode: employee.employeeCode,
        role: employee.role,
        lineUserId: lineId,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/my-shifts/:employeeId/:startDate/:endDate", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const { startDate, endDate } = req.params;
      const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, startDate, endDate);

      const emp = await storage.getEmployee(employeeId);
      const empRoleMap: Record<string, string> = {
        lifeguard: "救生", counter: "櫃檯", cleaning: "清潔", manager: "管理",
      };

      const venueIds = Array.from(new Set(myShifts.map((s) => s.venueId)));
      const venueMap: Record<number, any> = {};
      for (const vid of venueIds) {
        const v = await storage.getVenue(vid);
        if (v) venueMap[vid] = { id: v.id, name: v.name, shortName: v.shortName };
      }

      const slotsCache: Record<string, any[]> = {};
      async function getSlotsForVenueDate(venueId: number, date: string) {
        const key = `${venueId}-${date}`;
        if (!slotsCache[key]) {
          slotsCache[key] = await storage.getScheduleSlotsByVenueAndDate(venueId, date);
        }
        return slotsCache[key];
      }

      const enriched = await Promise.all(myShifts.map(async (s) => {
        const slots = await getSlotsForVenueDate(s.venueId, s.date);
        const shiftStart = s.startTime.slice(0, 5);
        const shiftEnd = s.endTime.slice(0, 5);
        const matchedSlot = slots.find((sl) =>
          sl.startTime.slice(0, 5) <= shiftStart && sl.endTime.slice(0, 5) >= shiftEnd
        ) || slots.find((sl) =>
          sl.startTime.slice(0, 5) <= shiftStart && shiftStart < sl.endTime.slice(0, 5)
        );
        const assignedRole = matchedSlot?.role || (emp ? empRoleMap[emp.role] : null) || null;
        return {
          ...s,
          venue: venueMap[s.venueId] || null,
          assignedRole,
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/today-coworkers/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const today = new Date().toISOString().split("T")[0];

      const empRoleMap: Record<string, string> = {
        lifeguard: "救生", counter: "櫃檯", cleaning: "清潔", manager: "管理",
      };

      const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, today, today);
      if (myShifts.length === 0) return res.json([]);

      const result: any[] = [];
      for (const shift of myShifts) {
        const venue = await storage.getVenue(shift.venueId);
        const coworkerEmployees = await storage.getCoworkersByVenueAndDate(shift.venueId, today, employeeId);

        const allVenueShifts = await storage.getShiftsByVenueAndDate(shift.venueId, today);
        const slots = await storage.getScheduleSlotsByVenueAndDate(shift.venueId, today);

        const coworkersWithShiftRole = coworkerEmployees.map((c) => {
          const cwShift = allVenueShifts.find((s) => s.employeeId === c.id);
          let shiftRole = empRoleMap[c.role] || c.role;
          if (cwShift) {
            const cwStart = cwShift.startTime.slice(0, 5);
            const cwEnd = cwShift.endTime.slice(0, 5);
            const matchedSlot = slots.find((sl) =>
              sl.startTime.slice(0, 5) <= cwStart && sl.endTime.slice(0, 5) >= cwEnd
            ) || slots.find((sl) =>
              sl.startTime.slice(0, 5) <= cwStart && cwStart < sl.endTime.slice(0, 5)
            );
            if (matchedSlot) shiftRole = matchedSlot.role;
          }
          return {
            id: c.id,
            name: c.name,
            phone: c.phone,
            role: c.role,
            shiftRole,
            shiftTime: cwShift ? `${cwShift.startTime.slice(0, 5)}-${cwShift.endTime.slice(0, 5)}` : null,
          };
        });

        const mySlot = slots.find((sl) => {
          const st = shift.startTime.slice(0, 5);
          return sl.startTime.slice(0, 5) <= st && sl.endTime.slice(0, 5) >= shift.endTime.slice(0, 5);
        }) || slots.find((sl) => {
          const st = shift.startTime.slice(0, 5);
          return sl.startTime.slice(0, 5) <= st && st < sl.endTime.slice(0, 5);
        });
        const emp = await storage.getEmployee(employeeId);
        const myRole = mySlot?.role || (emp ? empRoleMap[emp.role] : null) || null;

        result.push({
          venue: venue ? { id: venue.id, shortName: venue.shortName } : null,
          shiftTime: `${shift.startTime.slice(0, 5)}-${shift.endTime.slice(0, 5)}`,
          myRole,
          coworkers: coworkersWithShiftRole,
        });
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/guidelines-check/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, monthStart, monthEnd);
      const myVenueIds = Array.from(new Set(myShifts.map((s) => s.venueId)));

      const allGuidelines = await storage.getGuidelines();
      const activeGuidelines = allGuidelines.filter((g) => g.isActive);

      const relevant = activeGuidelines.filter((g) => {
        if (g.category === "fixed") {
          if (g.venueId) return myVenueIds.includes(g.venueId);
          return true;
        }
        if (g.category === "monthly") {
          return g.yearMonth === yearMonth;
        }
        if (g.category === "confidentiality") return true;
        return false;
      });

      const acks = await storage.getGuidelineAcksByEmployee(employeeId);
      const ackedIds = new Set(acks.map((a) => a.guidelineId));

      const currentMonthAcks = acks.filter((a) => {
        if (!a.acknowledgedAt) return false;
        const ackDate = new Date(a.acknowledgedAt);
        return ackDate.getFullYear() === now.getFullYear() && ackDate.getMonth() === now.getMonth();
      });
      const currentMonthAckedIds = new Set(currentMonthAcks.map((a) => a.guidelineId));

      const venueMap: Record<number, string> = {};
      for (const vid of myVenueIds) {
        const v = await storage.getVenue(vid);
        if (v) venueMap[vid] = v.shortName;
      }

      const items = relevant.map((g) => ({
        ...g,
        venueName: g.venueId ? venueMap[g.venueId] || null : null,
        acknowledged: currentMonthAckedIds.has(g.id),
      }));

      const allAcknowledged = items.every((i) => i.acknowledged);

      res.json({ items, allAcknowledged });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/acknowledge-all", async (req, res) => {
    try {
      const { employeeId, guidelineIds } = req.body;
      if (!employeeId || !Array.isArray(guidelineIds)) {
        return res.status(400).json({ message: "缺少必要參數" });
      }

      const existingAcks = await storage.getGuidelineAcksByEmployee(employeeId);
      const now = new Date();
      const existingThisMonth = existingAcks.filter((a) => {
        if (!a.acknowledgedAt) return false;
        const d = new Date(a.acknowledgedAt);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      });
      const alreadyAckedIds = new Set(existingThisMonth.map((a) => a.guidelineId));

      const toAck = guidelineIds.filter((id: number) => !alreadyAckedIds.has(id));
      for (const gid of toAck) {
        await storage.createGuidelineAck({ guidelineId: gid, employeeId });
      }

      res.json({ success: true, acknowledged: toAck.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/my-attendance/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const regionIds = [1, 2, 3];
      let employee: any = null;
      for (const rid of regionIds) {
        const emps = await storage.getEmployeesByRegion(rid);
        employee = emps.find((e) => e.id === employeeId);
        if (employee) break;
      }
      if (!employee) return res.status(404).json({ message: "找不到員工" });

      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const records = await storage.getAttendanceRecordsByDateRange(monthStart, monthEnd, [employee.employeeCode]);

      const summary = {
        total: records.length,
        late: records.filter((r) => r.isLate).length,
        earlyLeave: records.filter((r) => r.isEarlyLeave).length,
        anomaly: records.filter((r) => r.hasAnomaly).length,
        leave: records.filter((r) => r.leaveHours && r.leaveHours.trim() !== "").length,
        records: records.map((r) => ({
          date: r.date,
          clockIn: r.clockIn,
          clockOut: r.clockOut,
          isLate: r.isLate,
          isEarlyLeave: r.isEarlyLeave,
          hasAnomaly: r.hasAnomaly,
          leaveType: r.leaveType,
        })),
      };

      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ragic-venue-sync", async (_req, res) => {
    try {
      const result = await syncVenuesFromRagic();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ragic-sync", async (_req, res) => {
    try {
      const result = await syncFromRagic();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/send-shift-reminders", async (_req, res) => {
    try {
      const result = await sendShiftReminders();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/line/webhook", async (req: Request, res: Response) => {
    const signature = req.headers["x-line-signature"] as string;
    const forwardSecret = req.headers["x-forward-secret"] as string;
    const rawBody = req.rawBody ? Buffer.from(req.rawBody as any).toString("utf8") : JSON.stringify(req.body);

    const isDirectLine = signature && verifyLineSignature(rawBody, signature);
    const isForwarded = forwardSecret && verifyForwardedRequest(forwardSecret);

    if (!isDirectLine && !isForwarded) {
      console.error("[LINE Webhook] Authentication failed (neither LINE signature nor forward secret valid)");
      res.status(403).json({ message: "Invalid signature" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (isForwarded) {
      console.log("[LINE Webhook] Received forwarded request with", (body.events || []).length, "events");
    }
    res.status(200).json({ status: "ok" });

    try {
      await handleLineWebhook(body);
    } catch (err) {
      console.error("[LINE Webhook] Error handling event:", err);
    }
  });

  app.post("/api/liff/clock-in", async (req: Request, res: Response) => {
    try {
      const { lineUserId, employeeId, latitude, longitude, accuracy, clockType } = req.body;
      if ((!lineUserId && !employeeId) || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ message: "lineUserId or employeeId, latitude, longitude are required" });
      }
      console.log(`[Clock-in] User: ${lineUserId || `emp#${employeeId}`}, Lat: ${latitude}, Lng: ${longitude}, Accuracy: ${accuracy}m, Type: ${clockType || "auto"}`);
      const params = employeeId ? { employeeId: Number(employeeId) } : { lineUserId };
      const forcedType = clockType === "in" || clockType === "out" ? clockType : undefined;
      const result = await processClockIn(params, latitude, longitude, forcedType);
      res.json(result);
    } catch (err: any) {
      console.error("[Clock-in] Error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clock-records", async (req, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate required" });
      }
      let records;
      if (employeeId) {
        records = await storage.getClockRecordsByEmployee(
          Number(employeeId),
          startDate as string,
          endDate as string
        );
      } else {
        records = await storage.getClockRecordsByDateRange(
          startDate as string,
          endDate as string
        );
      }

      const employeeIds = [...new Set(records.map((r) => r.employeeId))];
      const employeeMap = new Map<number, any>();
      for (const id of employeeIds) {
        const emp = await storage.getEmployee(id);
        if (emp) employeeMap.set(id, emp);
      }

      const enriched = records.map((r) => ({
        ...r,
        employeeName: employeeMap.get(r.employeeId)?.name || "未知",
        employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/clock-amendment", async (req, res) => {
    try {
      const { employeeId, clockType, requestedTime, reason, venueId, shiftId } = req.body;
      if (!employeeId || !clockType || !requestedTime || !reason) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      const emp = await storage.getEmployee(employeeId);
      if (!emp) return res.status(404).json({ message: "找不到員工" });

      const record = await storage.createClockAmendment({
        employeeId,
        clockType,
        requestedTime: new Date(requestedTime),
        reason,
        venueId: venueId || null,
        shiftId: shiftId || null,
        status: "pending",
        reviewedBy: null,
        reviewNote: null,
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/clock-amendments/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const records = await storage.getClockAmendmentsByEmployee(employeeId);
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clock-amendments", async (req, res) => {
    try {
      const { status } = req.query;
      const records = await storage.getClockAmendments(status as string | undefined);

      const employeeIds = [...new Set(records.map(r => r.employeeId))];
      const employeeMap = new Map<number, any>();
      for (const id of employeeIds) {
        const emp = await storage.getEmployee(id);
        if (emp) employeeMap.set(id, emp);
      }

      const enriched = records.map(r => ({
        ...r,
        employeeName: employeeMap.get(r.employeeId)?.name || "未知",
        employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/clock-amendments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, reviewNote } = req.body;
      if (!status || !["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "status 必須為 approved 或 rejected" });
      }

      const amendment = await storage.getClockAmendment(id);
      if (!amendment) return res.status(404).json({ message: "找不到補打卡申請" });
      if (amendment.status !== "pending") {
        return res.status(400).json({ message: "此申請已審核完畢" });
      }

      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      const updated = await storage.updateClockAmendmentStatus(id, status, adminId, adminName, reviewNote);

      if (status === "approved" && updated) {
        try {
          await storage.createClockRecord({
            employeeId: updated.employeeId,
            venueId: updated.venueId,
            shiftId: updated.shiftId,
            clockType: updated.clockType,
            latitude: 0,
            longitude: 0,
            distance: 0,
            status: "success",
            failReason: "補打卡",
            matchedVenueName: null,
            clockTime: updated.requestedTime,
          });
        } catch (recordErr: any) {
          await storage.updateClockAmendmentStatus(id, "pending", 0, "系統", "系統錯誤：打卡紀錄建立失敗，請重新審核");
          return res.status(500).json({ message: "打卡紀錄建立失敗: " + recordErr.message });
        }
      }

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/portal/clock-records/:id/reason", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { earlyArrivalReason, lateDepartureReason } = req.body;
      if (!earlyArrivalReason && !lateDepartureReason) {
        return res.status(400).json({ message: "請提供原因" });
      }
      const updated = await storage.updateClockRecordReason(id, earlyArrivalReason, lateDepartureReason);
      if (!updated) return res.status(404).json({ message: "找不到打卡紀錄" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/portal/overtime-request", async (req, res) => {
    try {
      const { employeeId, date, startTime, endTime, reason } = req.body;
      if (!employeeId || !date || !startTime || !endTime || !reason) {
        return res.status(400).json({ message: "缺少必要欄位" });
      }
      const emp = await storage.getEmployee(employeeId);
      if (!emp) return res.status(404).json({ message: "找不到員工" });

      const record = await storage.createOvertimeRequest({
        employeeId,
        date,
        startTime,
        endTime,
        reason,
        status: "pending",
        reviewedBy: null,
        reviewedByName: null,
        reviewNote: null,
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/portal/overtime-requests/:employeeId", async (req, res) => {
    try {
      const employeeId = parseInt(req.params.employeeId);
      const records = await storage.getOvertimeRequestsByEmployee(employeeId);
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/overtime-requests", async (req, res) => {
    try {
      const { status } = req.query;
      const records = await storage.getOvertimeRequests(status as string | undefined);

      const employeeIds = [...new Set(records.map(r => r.employeeId))];
      const employeeMap = new Map<number, any>();
      for (const id of employeeIds) {
        const emp = await storage.getEmployee(id);
        if (emp) employeeMap.set(id, emp);
      }

      const enriched = records.map(r => ({
        ...r,
        employeeName: employeeMap.get(r.employeeId)?.name || "未知",
        employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/overtime-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status, reviewNote } = req.body;
      if (!status || !["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "status 必須為 approved 或 rejected" });
      }

      const request = await storage.getOvertimeRequest(id);
      if (!request) return res.status(404).json({ message: "找不到加班申請" });
      if (request.status !== "pending") {
        return res.status(400).json({ message: "此申請已審核完畢" });
      }

      const adminId = req.session.adminId || 0;
      const adminName = req.session.adminName || "管理員";
      const updated = await storage.updateOvertimeRequestStatus(id, status, adminId, adminName, reviewNote);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const anomalyUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("僅支援圖片檔案"));
    },
  });

  app.post("/api/anomaly-report", anomalyUpload.array("images", 5), async (req, res) => {
    try {
      const body = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body;
      const { employee, clockResult, errorMsg, context, userNote } = body;
      if (!context) return res.status(400).json({ message: "缺少異常類型 (context)" });

      const files = (req.files as Express.Multer.File[]) || [];
      const imageUrls = files.map(f => `data:${f.mimetype};base64,${f.buffer.toString("base64")}`);

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const timestamp = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const lines: string[] = [
        "!!!打卡異常報告!!!",
        `報告時間：${timestamp}`,
        `異常類型：${context}`,
        "──────────────",
      ];

      if (employee) {
        if (employee.name) lines.push(`員工姓名：${employee.name}`);
        if (employee.employeeCode) lines.push(`員工編號：${employee.employeeCode}`);
        if (employee.role) lines.push(`職務角色：${employee.role}`);
        if (employee.lineUserId) lines.push(`LINE User ID：${employee.lineUserId}`);
      } else {
        lines.push("員工資訊：尚未登入 / 無法取得");
      }
      lines.push("──────────────");

      if (clockResult) {
        lines.push(`打卡狀態：${clockResult.status === "success" ? "成功" : clockResult.status === "warning" ? "警告（無排班）" : "失敗"}`);
        if (clockResult.clockType) lines.push(`打卡類型：${clockResult.clockType === "in" ? "上班" : "下班"}`);
        if (clockResult.time) lines.push(`打卡時間：${clockResult.date || ""} ${clockResult.time}`);
        if (clockResult.venueName) lines.push(`場館名稱：${clockResult.venueName}`);
        if (clockResult.distance !== null && clockResult.distance !== undefined) {
          lines.push(`距離場館：${clockResult.distance}m${clockResult.radius ? ` (需在${clockResult.radius}m內)` : ""}`);
        }
        if (clockResult.failReason) lines.push(`異常原因：${clockResult.failReason}`);
      }

      if (errorMsg) lines.push(`錯誤訊息：${errorMsg}`);
      if (userNote) lines.push(`使用者備註：${userNote}`);
      if (imageUrls.length > 0) lines.push(`附件圖片：${imageUrls.length} 張`);

      lines.push("──────────────");
      lines.push("※ 此為系統自動產生之異常報告，請勿修改內容，將此文字訊息以及異常畫面圖片傳送至400感謝配合。");

      const reportText = lines.join("\n");

      const record = await storage.createAnomalyReport({
        employeeId: employee?.id || null,
        employeeName: employee?.name || null,
        employeeCode: employee?.employeeCode || null,
        role: employee?.role || null,
        lineUserId: employee?.lineUserId || null,
        context,
        clockStatus: clockResult?.status || null,
        clockType: clockResult?.clockType || null,
        clockTime: clockResult?.time ? `${clockResult.date || ""} ${clockResult.time}` : null,
        venueName: clockResult?.venueName || null,
        distance: clockResult?.distance !== null && clockResult?.distance !== undefined ? `${clockResult.distance}m` : null,
        failReason: clockResult?.failReason || null,
        errorMsg: errorMsg || null,
        userNote: userNote || null,
        imageUrls: imageUrls.length > 0 ? imageUrls : null,
        reportText,
      });

      try {
        const recipients = await storage.getNotificationRecipients();
        const targets = recipients.filter(r => r.enabled && r.notifyNewReport);
        if (targets.length > 0) {
          await sendAnomalyEmail(
            targets.map(r => r.email),
            `🚨 員工打卡異常 — ${employee?.name || "未知"}（${clockResult?.venueName || "未知場館"}）`,
            `<h2>員工打卡異常</h2>
            <p><b>姓名：</b>${employee?.name || "未知"}</p>
            <p><b>員工編號：</b>${employee?.employeeCode || "未知"}</p>
            <p><b>職位：</b>${employee?.role || "未知"}</p>
            <p><b>場館：</b>${clockResult?.venueName || "未知"}</p>
            <p><b>時間：</b>${clockResult?.time ? `${clockResult.date || ""} ${clockResult.time}` : "未知"}</p>
            <p><b>原因：</b>${clockResult?.failReason || errorMsg || "未知"}</p>
            ${userNote ? `<p><b>員工備註：</b>${userNote}</p>` : ""}
            ${imageUrls.length > 0 ? `<p><b>附件圖片：</b>${imageUrls.length} 張</p>` : ""}`
          );
        }
      } catch (emailErr) {
        console.error("[EMAIL] New anomaly notification failed:", emailErr);
      }

      res.json({
        id: record.id,
        reportText,
        imageUrls,
        createdAt: record.createdAt,
        lineUrl: "https://lin.ee/TupPc0V",
      });
    } catch (err: any) {
      console.error("Anomaly report error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/anomaly-reports", async (req, res) => {
    try {
      const reports = await storage.getAnomalyReports();
      res.json(reports);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/anomaly-reports/:id", async (req, res) => {
    try {
      const report = await storage.getAnomalyReport(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "找不到此異常報告" });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/anomaly-reports/batch/resolution", async (req, res) => {
    try {
      const { ids, resolution, resolvedNote } = req.body;
      if (!ids || !Array.isArray(ids) || !resolution) {
        return res.status(400).json({ message: "缺少 ids 或 resolution" });
      }
      const results = [];
      for (const id of ids) {
        const record = await storage.updateAnomalyResolution(Number(id), resolution, resolvedNote);
        if (record) results.push(record);
      }

      try {
        const recipients = await storage.getNotificationRecipients();
        const targets = recipients.filter(r => r.enabled && r.notifyResolution);
        if (targets.length > 0 && results.length > 0) {
          const names = results.map(r => r.employeeName || "未知").join("、");
          await sendAnomalyEmail(
            targets.map(r => r.email),
            `批量處理更新 — ${results.length} 筆異常報告`,
            `<h2>批量處理更新</h2>
            <p><b>數量：</b>${results.length} 筆</p>
            <p><b>員工：</b>${names}</p>
            <p><b>狀態：</b>${resolution === "resolved" ? "已處理" : "待解決"}</p>
            <p><b>備註：</b>${resolvedNote || "無"}</p>`
          );
        }
      } catch (emailErr) {
        console.error("[EMAIL] Batch resolution notification failed:", emailErr);
      }

      res.json({ updated: results.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/anomaly-reports/:id/resolution", async (req, res) => {
    try {
      const { resolution, resolvedNote } = req.body;
      if (!resolution) return res.status(400).json({ message: "缺少 resolution" });
      const record = await storage.updateAnomalyResolution(Number(req.params.id), resolution, resolvedNote);
      if (!record) return res.status(404).json({ message: "找不到此異常報告" });

      try {
        const recipients = await storage.getNotificationRecipients();
        const targets = recipients.filter(r => r.enabled && r.notifyResolution);
        if (targets.length > 0) {
          await sendAnomalyEmail(
            targets.map(r => r.email),
            `打卡異常處理更新 — ${record.employeeName || "未知"}（${record.venueName || "未知場館"}）`,
            `<h2>打卡異常處理更新</h2>
            <p><b>姓名：</b>${record.employeeName || "未知"}</p>
            <p><b>場館：</b>${record.venueName || "未知"}</p>
            <p><b>狀態：</b>${resolution === "resolved" ? "已處理" : "待解決"}</p>
            <p><b>備註：</b>${resolvedNote || "無"}</p>
            <p><b>原始異常時間：</b>${record.clockTime || "未知"}</p>`
          );
        }
      } catch (emailErr) {
        console.error("[EMAIL] Resolution notification failed:", emailErr);
      }

      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/anomaly-reports/batch/delete", async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "缺少 ids" });
      let deleted = 0;
      for (const id of ids) {
        await storage.deleteAnomalyReport(Number(id));
        deleted++;
      }
      res.json({ success: true, deleted });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/anomaly-reports/:id", async (req, res) => {
    try {
      await storage.deleteAnomalyReport(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/notification-recipients", async (_req, res) => {
    try {
      const recipients = await storage.getNotificationRecipients();
      res.json(recipients);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notification-recipients", async (req, res) => {
    try {
      const { email, label, enabled, notifyNewReport, notifyResolution } = req.body;
      if (!email) return res.status(400).json({ message: "缺少 email" });
      const record = await storage.createNotificationRecipient({
        email,
        label: label || null,
        enabled: enabled !== false,
        notifyNewReport: notifyNewReport !== false,
        notifyResolution: notifyResolution !== false,
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/notification-recipients/:id", async (req, res) => {
    try {
      const record = await storage.updateNotificationRecipient(Number(req.params.id), req.body);
      if (!record) return res.status(404).json({ message: "找不到此收件者" });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/notification-recipients/:id", async (req, res) => {
    try {
      await storage.deleteNotificationRecipient(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/test-email", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "缺少 email" });
      await sendAnomalyEmail(
        [email],
        "測試郵件 — DAOS 打卡異常通知系統",
        `<h2>測試郵件</h2><p>此為 DAOS 打卡異常通知系統的測試郵件。</p><p>如果您收到此郵件，表示郵件通知功能運作正常。</p><p>發送時間：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>`
      );
      res.json({ success: true, message: "測試郵件已發送" });
    } catch (err: any) {
      console.error("[EMAIL] Test email failed:", err);
      res.status(500).json({ message: `郵件發送失敗: ${err.message}` });
    }
  });

  return httpServer;
}

async function sendAnomalyEmail(to: string[], subject: string, html: string) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER || "daos.ragic.system@gmail.com",
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"DAOS 打卡異常通知" <${process.env.GMAIL_USER || "daos.ragic.system@gmail.com"}>`,
    to: to.join(", "),
    subject,
    html: `<div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${html}
      <hr style="margin-top: 20px; border: none; border-top: 1px solid #e5e7eb;" />
      <p style="color: #9ca3af; font-size: 12px;">此為系統自動發送的通知郵件，請勿直接回覆。</p>
    </div>`,
  });
}
