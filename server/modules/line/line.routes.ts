/* eslint-disable */
  /**
   * line HTTP routes — extracted from server/routes.ts as part of
   * Task #69 server architecture refactor. Handler bodies are byte-identical
   * to the original block; only the imports and `mountLineLiffRoutes`
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
  
  export function mountLineLiffRoutes(httpServer: Server, app: Express): void {
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

      if (lineUserId && isValidLineUserId(lineUserId)) {
        const emp = await storage.getEmployeeByLineId(lineUserId);
        if (emp && (!emp.lineId || !isValidLineUserId(emp.lineId))) {
          await storage.updateEmployee(emp.id, { lineId: lineUserId });
          console.log(`[LIFF] 自動回寫 LINE ID: ${emp.name}(${emp.employeeCode}) → ${lineUserId}`);
        }
      }

      const params = employeeId ? { employeeId: Number(employeeId) } : { lineUserId };
      const forcedType = clockType === "in" || clockType === "out" ? clockType : undefined;
      const result = await processClockIn(params, latitude, longitude, forcedType);

      if (result.status === "success" || result.status === "warning") {
        try {
          let empToNotify = null;
          if (lineUserId && isValidLineUserId(lineUserId)) {
            empToNotify = await storage.getEmployeeByLineId(lineUserId);
          } else if (employeeId) {
            empToNotify = await storage.getEmployee(Number(employeeId));
          }
          if (empToNotify?.lineId && isValidLineUserId(empToNotify.lineId)) {
            const msg = formatClockInMessage(result);
            await pushToLine(empToNotify.lineId, msg);
            if (result.clockType === "in") {
              pushPendingGuidelinesIfAny(empToNotify.id, empToNotify.lineId).catch(() => {});
            }
          }
        } catch (pushErr) {
          console.error("[LIFF] LINE push error:", pushErr);
        }
      }

      res.json(result);
    } catch (err: any) {
      console.error("[Clock-in] Error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  }
  
  