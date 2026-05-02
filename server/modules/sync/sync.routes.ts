/* eslint-disable */
  /**
   * sync HTTP routes — extracted from server/routes.ts as part of
   * Task #69 server architecture refactor. Handler bodies are byte-identical
   * to the original block; only the imports and `mountSyncRoutes`
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
  
  export function mountSyncRoutes(httpServer: Server, app: Express): void {
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

  app.post("/api/send-shift-reminders", async (req, res) => {
    try {
      const force = req.body?.force === true;
      const result = await sendShiftReminders(force);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trigger-weekly-schedule", async (req, res) => {
    if (!req.session.adminId) {
      return res.status(401).json({ message: "未登入" });
    }
    try {
      const force = req.body?.force === true; // default false (respect dedup)
      const result = await sendWeeklySchedulePush(force);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/trigger-weekly-late-report", async (req, res) => {
    if (!req.session.adminId) {
      return res.status(401).json({ message: "未登入" });
    }
    try {
      const force = req.body?.force === true; // default false (respect dedup)
      const result = await sendWeeklyLateReport(force);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  }
  
  