/* eslint-disable */
  /**
   * overtime HTTP routes — extracted from server/routes.ts as part of
   * Task #69 server architecture refactor. Handler bodies are byte-identical
   * to the original block; only the imports and `mountOvertimeRoutes`
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
  
  export function mountOvertimeRoutes(httpServer: Server, app: Express): void {
    app.post("/api/portal/overtime-request", async (req, res) => {
    try {
      const { employeeId, date, startTime, endTime, reason, evidenceImageUrl } = req.body;
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
        evidenceImageUrl: evidenceImageUrl || null,
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

      const clockRecordIds = records.filter(r => r.clockRecordId).map(r => r.clockRecordId!);
      const clockRecordMap = new Map<number, any>();
      for (const crId of clockRecordIds) {
        const cr = await storage.getClockRecord(crId);
        if (cr) clockRecordMap.set(crId, cr);
      }

      const enriched = records.map(r => ({
        ...r,
        employeeName: employeeMap.get(r.employeeId)?.name || "未知",
        employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
        linkedClockTime: r.clockRecordId && clockRecordMap.has(r.clockRecordId)
          ? clockRecordMap.get(r.clockRecordId).clockTime
          : null,
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
  }
  
  