/* eslint-disable */
  /**
   * employee HTTP routes — extracted from server/routes.ts as part of
   * Task #69 server architecture refactor. Handler bodies are byte-identical
   * to the original block; only the imports and `mountEmployeeRoutes`
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
  
  export function mountEmployeeRoutes(httpServer: Server, app: Express): void {
    app.get("/api/employees-all", async (_req, res) => {
    const allEmployees = await storage.getAllEmployees();
    const filtered = allEmployees.filter((e) => e.status === "active");
    res.json(filtered);
  });

  app.get("/api/employees", async (req, res) => {
    try {
      const { codes } = req.query;
      if (!codes) return res.status(400).json({ message: "codes 查詢參數為必填" });
      const codeList = String(codes).split(",").map(c => c.trim()).filter(Boolean);
      if (codeList.length === 0) return res.json({});
      const allEmployees = await storage.getAllEmployees();
      const result: Record<string, { id: number; name: string; employeeCode: string; status: string }> = {};
      for (const code of codeList) {
        const emp = allEmployees.find(e => e.employeeCode === code);
        if (emp) {
          result[code] = { id: emp.id, name: emp.name, employeeCode: emp.employeeCode, status: emp.status };
        }
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/employees/:regionCode", async (req, res) => {
    const { regionCode } = req.params;
    const codes = regionCode.split(",").map(c => c.trim()).filter(Boolean);
    const seen = new Set<number>();
    const out: Employee[] = [];
    for (const code of codes) {
      const region = await storage.getRegionByCode(code);
      if (!region) continue;
      const list = code === "D"
        ? await storage.getEmployeesForNeiQin(region.id)
        : await storage.getEmployeesByRegion(region.id);
      for (const e of list) {
        if (e.status !== "active") continue;
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
    }
    res.json(out);
  });

  app.post("/api/employees", async (req, res) => {
    try {
      const parsed = insertEmployeeSchema.parse(req.body);
      const employee = await storage.createEmployee(parsed);
      storage.reconcileDispatchLinks().catch(() => {});
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
      storage.reconcileDispatchLinks().catch(() => {});
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

  }
  
  