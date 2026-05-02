/* eslint-disable */
  /**
   * guideline HTTP routes — extracted from server/routes.ts as part of
   * Task #69 server architecture refactor. Handler bodies are byte-identical
   * to the original block; only the imports and `mountGuidelineRoutes`
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
  
  export function mountGuidelineRoutes(httpServer: Server, app: Express): void {
    app.get("/api/guidelines", async (req, res) => {
    const { category } = req.query;
    const items = await storage.getGuidelines(category ? String(category) : undefined);
    const stripped = items.map(({ imageUrl, imageUrls, ...rest }) => ({
      ...rest,
      imageCount: (imageUrls && imageUrls.length > 0) ? imageUrls.length : (imageUrl ? 1 : 0),
    }));
    res.json(stripped);
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

  }
  
  