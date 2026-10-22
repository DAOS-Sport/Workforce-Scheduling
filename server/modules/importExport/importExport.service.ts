/**
 * importExport service — XLSX → multi-table ingestion.
 *
 * Today only the punch-record import (POST /api/attendance-upload) lives
 * here. Future ingest endpoints (e.g. employee bulk import, venue bulk
 * import) should add a parser here so the route layer keeps just multer
 * + JSON-shape concerns.
 *
 * Low-level Excel helpers (resolveCellValue, loadWorkbook, extractRows)
 * are imported from server/infra/excel/excelParser.ts — the canonical
 * infra location — so this service owns only attendance-domain logic.
 */
import { type InsertAttendanceRecord } from "@shared/schema";
import {
  loadWorkbook,
  resolveCellValue,
} from "../../infra/excel/excelParser";
import { attendanceService } from "../attendance/attendance.service";

export const importExportService = {
  async importAttendanceXlsx(buffer: Buffer, originalFileName: string) {
    const workbook = await loadWorkbook(buffer);

    const punchWorksheet = workbook.worksheets.find((ws) =>
      ws.name.includes("打卡紀錄"),
    );
    const punchSheetName = punchWorksheet?.name;
    if (!punchSheetName || !punchWorksheet) {
      const err: any = new Error(
        "找不到「打卡紀錄」工作表，請確認檔案格式",
      );
      err.status = 400;
      throw err;
    }

    const punchData: unknown[][] = [];
    punchWorksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      const rowData = Array.from(
        { length: Math.max(values.length - 1, 0) },
        (_, i) => resolveCellValue(values[i + 1]),
      );
      punchData.push(rowData);
    });

    if (punchData.length < 2) {
      const err: any = new Error("打卡紀錄表無數據");
      err.status = 400;
      throw err;
    }

    const periodMatch = punchSheetName.match(
      /(\d{4}\.\d{2}\.\d{2})-(\d{4}\.\d{2}\.\d{2})/,
    );
    let periodStart = "";
    let periodEnd = "";
    if (periodMatch) {
      periodStart = periodMatch[1].replace(/\./g, "-");
      periodEnd = periodMatch[2].replace(/\./g, "-");
    }

    const headers = punchData[0].map((h) => String(h).trim());
    const requiredHeaders = ["員工編號", "姓名", "打卡日期"];
    const missingHeaders = requiredHeaders.filter(
      (h) => !headers.includes(h),
    );
    if (missingHeaders.length > 0) {
      const err: any = new Error(
        `打卡紀錄表缺少必要欄位：${missingHeaders.join(", ")}`,
      );
      err.status = 400;
      throw err;
    }

    const colIdx = (name: string) => headers.indexOf(name);

    const safeGet = (row: unknown[], name: string): string => {
      const idx = colIdx(name);
      if (idx < 0 || idx >= row.length) return "";
      const val = row[idx];
      if (val === null || val === undefined) return "";
      return String(val).trim();
    };

    const records: InsertAttendanceRecord[] = [];
    const uploadRecord = await attendanceService.createAttendanceUpload({
      fileName: originalFileName,
      periodStart: periodStart || "2026-01-01",
      periodEnd: periodEnd || "2026-01-31",
      totalRecords: 0,
    });

    const clean = (val: string) =>
      val === "--" || val === "" ? null : val;

    for (let i = 1; i < punchData.length; i++) {
      const row = punchData[i] as unknown[];
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
        isLate:
          lateVal !== "" &&
          lateVal !== "--" &&
          lateVal !== "0" &&
          lateVal !== "00:00:00",
        isEarlyLeave:
          earlyVal !== "" &&
          earlyVal !== "--" &&
          earlyVal !== "0" &&
          earlyVal !== "00:00:00",
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

    const savedRecords = await attendanceService.createAttendanceRecords(records);
    await attendanceService.updateAttendanceUpload(uploadRecord.id, {
      totalRecords: savedRecords.length,
    });

    return {
      uploadId: uploadRecord.id,
      fileName: originalFileName,
      periodStart,
      periodEnd,
      totalRecords: savedRecords.length,
      message: `成功匯入 ${savedRecords.length} 筆打卡紀錄`,
    };
  },
};
