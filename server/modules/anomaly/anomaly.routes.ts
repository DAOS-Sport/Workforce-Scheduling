/* eslint-disable */
  /**
   * anomaly HTTP routes — extracted from server/routes.ts as part of
   * Task #69 server architecture refactor. Handler bodies are byte-identical
   * to the original block; only the imports and `mountAnomalyRoutes`
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
  
  export function mountAnomalyRoutes(httpServer: Server, app: Express): void {
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
  }
  

  
