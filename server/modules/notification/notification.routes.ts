/* eslint-disable */
  /**
   * notification HTTP routes — extracted from server/routes.ts as part of
   * Task #69 server architecture refactor. Handler bodies are byte-identical
   * to the original block; only the imports and `mountNotificationRoutes`
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
import { sendAnomalyEmail } from "../../shared/email/sendAnomalyEmail";

  const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];
  
  export function mountNotificationRoutes(httpServer: Server, app: Express): void {
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

  }
  
  