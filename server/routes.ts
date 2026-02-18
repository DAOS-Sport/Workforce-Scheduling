import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { REGIONS_DATA, VENUES_DATA, insertEmployeeSchema, insertVenueSchema, insertShiftSchema, insertScheduleSlotSchema, insertVenueShiftTemplateSchema, insertGuidelineSchema, insertGuidelineAckSchema, type InsertAttendanceRecord, type ShiftValidationError } from "@shared/schema";
import { z } from "zod";
import { validateAllRules } from "./labor-validation";
import multer from "multer";
import * as XLSX from "xlsx";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/regions", async (_req, res) => {
    const regions = await storage.getRegions();
    res.json(regions);
  });

  app.get("/api/employees/:regionCode", async (req, res) => {
    const { regionCode } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const employees = await storage.getEmployeesByRegion(region.id);
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

      const shift = await storage.createShift(parsed);

      const warnings = errors.filter((e: ShiftValidationError) => e.type === "rest_11h");
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

      const existingShifts = await storage.getShiftsByEmployee(employeeId);
      const errors = validateAllRules(employeeId, date, startTime, endTime, existingShifts, id);
      const blocking = errors.filter((e: ShiftValidationError) => e.type === "seven_day_rest" || e.type === "daily_12h");
      if (blocking.length > 0) {
        return res.status(400).json({ message: blocking[0].message });
      }

      const shift = await storage.updateShift(id, partial);
      const warnings = errors.filter((e: ShiftValidationError) => e.type === "rest_11h");
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

  app.get("/api/schedule-slots/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.json([]);
    const slots = await storage.getScheduleSlotsByRegionAndDateRange(region.id, startDate, endDate);
    res.json(slots);
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

      const venueIds = Array.from(new Set(myShifts.map((s) => s.venueId)));
      const venueMap: Record<number, any> = {};
      for (const vid of venueIds) {
        const v = await storage.getVenue(vid);
        if (v) venueMap[vid] = { id: v.id, name: v.name, shortName: v.shortName };
      }

      const enriched = myShifts.map((s) => ({
        ...s,
        venue: venueMap[s.venueId] || null,
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

      const myShifts = await storage.getShiftsByEmployeeAndDateRange(employeeId, today, today);
      if (myShifts.length === 0) return res.json([]);

      const result: any[] = [];
      for (const shift of myShifts) {
        const venue = await storage.getVenue(shift.venueId);
        const coworkers = await storage.getCoworkersByVenueAndDate(shift.venueId, today, employeeId);
        result.push({
          venue: venue ? { id: venue.id, shortName: venue.shortName } : null,
          shiftTime: `${shift.startTime.slice(0, 5)}-${shift.endTime.slice(0, 5)}`,
          coworkers: coworkers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            role: c.role,
          })),
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

  return httpServer;
}
