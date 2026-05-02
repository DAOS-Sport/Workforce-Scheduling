/* eslint-disable */
  /**
   * attendance HTTP routes — extracted from server/routes.ts as part of
   * Task #69 server architecture refactor. Handler bodies are byte-identical
   * to the original block; only the imports and `mountAttendanceRoutes`
   * wrapper are new. Storage protections (Task #50 force=true), audit
   * writes, and soft-delete semantics remain in server/storage.ts.
   */
  import express, { type Express, type Request, type Response } from "express";
  import { type Server } from "http";
  import { storage } from "../../storage";
  import { REGIONS_DATA, VENUES_DATA, insertEmployeeSchema, insertVenueSchema, insertShiftSchema, insertScheduleSlotSchema, insertVenueShiftTemplateSchema, insertGuidelineSchema, insertGuidelineAckSchema, announcements, insertAnnouncementSchema, clockAmendments, overtimeRequests, leaveRequests, anomalyReports, type InsertAttendanceRecord, type ShiftValidationError, getFourWeekPeriod, calcShiftHours, sumScheduledHours, getAllPeriodsForMonth, type Employee, type Venue, type Shift, type ScheduleSlot, type DispatchShift } from "@shared/schema";
  import { z } from "zod";
  import { validateAllRules } from "../../labor-validation";
  import { syncFromRagic, syncVenuesFromRagic } from "../../ragic";
  import { verifyLineSignature, verifyForwardedRequest, handleLineWebhook, processClockIn, sendShiftReminders, pushToLine, isValidLineUserId, formatClockInMessage, sendWeeklySchedulePush, sendWeeklyLateReport, pushPendingGuidelinesIfAny, invalidateVenueCache } from "../../line-webhook";
  import { db } from "../../db";
  import { eq, isNull, isNotNull, and, gte, lte, count } from "drizzle-orm";
  import { dispatchShifts as dispatchShiftsTable } from "@shared/schema";
  import multer from "multer";
  import ExcelJS from "exceljs";
  import nodemailer from "nodemailer";

  const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];
  
  export function mountAttendanceRoutes(httpServer: Server, app: Express): void {
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
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);

      const punchWorksheet = workbook.worksheets.find((ws) => ws.name.includes("打卡紀錄"));
      const punchSheetName = punchWorksheet?.name;
      if (!punchSheetName || !punchWorksheet) {
        return res.status(400).json({ message: "找不到「打卡紀錄」工作表，請確認檔案格式" });
      }

      const resolveCellValue = (v: any): any => {
        if (v === null || v === undefined) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === "object") {
          if ("richText" in v && Array.isArray(v.richText))
            return v.richText.map((r: any) => r.text ?? "").join("").trim();
          if ("result" in v) return resolveCellValue(v.result);
          if ("text" in v) return String(v.text).trim();
          if ("hyperlink" in v && "text" in v) return String(v.text).trim();
        }
        return v;
      };

      const punchData: any[][] = [];
      punchWorksheet.eachRow({ includeEmpty: true }, (row) => {
        const values = row.values as any[];
        const rowData = Array.from({ length: Math.max(values.length - 1, 0) }, (_, i) =>
          resolveCellValue(values[i + 1])
        );
        punchData.push(rowData);
      });
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

  }
  
  