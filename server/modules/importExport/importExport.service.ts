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
import { createHash } from "node:crypto";
import { type InsertAttendanceRecord } from "@shared/schema";
import {
  loadWorkbook,
  resolveCellValue,
} from "../../infra/excel/excelParser";
import { claimRequestKey, storedRequestResult, storeRequestResult } from "../../infra/db/idempotency";
import { withTx } from "../../infra/db/tx";
import { httpError } from "../../shared/errors";
import { attendanceService } from "../attendance/attendance.service";

/** idempotency_keys scope for a whole attendance file; the key is a hash of what the file holds. */
const UPLOAD_SCOPE = "attendance-upload";

/** `2026/7/6`, `2026-07-06` → `2026-07-06`; anything that is not a real calendar day → null. */
function sheetDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const day = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(date) ? date : null;
}

type ParsedRecord = Omit<InsertAttendanceRecord, "uploadId">;

export const importExportService = {
  /**
   * Import one punch-record workbook. Every row is read and checked first; only a file with no bad
   * rows is written, as one transaction (upload row, records in batches of 100, record count), so a
   * failure anywhere leaves nothing behind. A file whose content was already imported is refused
   * while that upload still exists.
   */
  async importAttendanceXlsx(buffer: Buffer, originalFileName: string) {
    const workbook = await loadWorkbook(buffer);

    const punchWorksheet = workbook.worksheets.find((ws) =>
      ws.name.includes("打卡紀錄"),
    );
    const punchSheetName = punchWorksheet?.name;
    if (!punchSheetName || !punchWorksheet) {
      throw httpError(400, "找不到「打卡紀錄」工作表，請確認檔案格式");
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
      throw httpError(400, "打卡紀錄表無數據");
    }

    const headers = punchData[0].map((h) => String(h).trim());
    const requiredHeaders = ["員工編號", "姓名", "打卡日期"];
    const missingHeaders = requiredHeaders.filter(
      (h) => !headers.includes(h),
    );
    if (missingHeaders.length > 0) {
      throw httpError(400, `打卡紀錄表缺少必要欄位：${missingHeaders.join(", ")}`);
    }

    const colIdx = (name: string) => headers.indexOf(name);

    const safeGet = (row: unknown[], name: string): string => {
      const idx = colIdx(name);
      if (idx < 0 || idx >= row.length) return "";
      const val = row[idx];
      if (val === null || val === undefined) return "";
      return String(val).trim();
    };

    const clean = (val: string) =>
      val === "--" || val === "" ? null : val;

    const records: ParsedRecord[] = [];
    const badDates: string[] = [];
    for (let i = 1; i < punchData.length; i++) {
      const row = punchData[i] as unknown[];
      const empCode = safeGet(row, "員工編號");
      const empName = safeGet(row, "姓名");
      if (!empCode || !empName) continue;

      const rawDate = safeGet(row, "打卡日期");
      if (!rawDate) continue;
      const dateStr = sheetDate(rawDate);
      if (!dateStr) {
        badDates.push(`第 ${i + 1} 列「${rawDate}」`);
        continue;
      }

      const lateVal = safeGet(row, "遲到");
      const earlyVal = safeGet(row, "早退");
      const anomalyVal = clean(safeGet(row, "出勤異常"));

      records.push({
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

    if (badDates.length > 0) {
      const shown = badDates.slice(0, 10).join("、");
      throw httpError(400, `打卡日期無法辨識，整份檔案沒有匯入：${shown}${badDates.length > 10 ? ` 等 ${badDates.length} 列` : ""}`);
    }
    if (records.length === 0) {
      throw httpError(400, "打卡紀錄表沒有可匯入的資料列");
    }

    // The period named in the sheet ("打卡紀錄2026.07.01-2026.07.31"), else the span of the rows' dates.
    const periodMatch = punchSheetName.match(/(\d{4}\.\d{2}\.\d{2})-(\d{4}\.\d{2}\.\d{2})/);
    const named = periodMatch ? [sheetDate(periodMatch[1].replace(/\./g, "-")), sheetDate(periodMatch[2].replace(/\./g, "-"))] : [null, null];
    const dates = records.map((r) => r.date).sort();
    const periodStart = named[0] && named[1] ? named[0] : dates[0];
    const periodEnd = named[0] && named[1] ? named[1] : dates[dates.length - 1];

    const contentKey = createHash("sha256").update(JSON.stringify({ periodStart, periodEnd, records })).digest("hex");

    return withTx(async (tx) => {
      if (!(await claimRequestKey(tx, UPLOAD_SCOPE, contentKey))) {
        // Imported before. Refuse while that upload exists; once it was deleted, import again under the same key.
        const stored = (await storedRequestResult(tx, UPLOAD_SCOPE, contentKey, { lock: true })) as { uploadId?: number } | undefined;
        const earlier = stored?.uploadId ? await attendanceService.getAttendanceUpload(stored.uploadId, tx) : undefined;
        if (earlier) {
          throw httpError(409, `這份打卡紀錄已經匯入過（上傳批次 #${earlier.id}「${earlier.fileName}」），沒有重複匯入。要重新匯入請先刪除該批次。`, { uploadId: earlier.id });
        }
      }

      const uploadRecord = await attendanceService.createAttendanceUpload({
        fileName: originalFileName,
        periodStart,
        periodEnd,
        totalRecords: 0,
      }, tx);
      const savedRecords = await attendanceService.createAttendanceRecords(
        records.map((r) => ({ ...r, uploadId: uploadRecord.id })),
        tx,
      );
      await attendanceService.updateAttendanceUpload(uploadRecord.id, { totalRecords: savedRecords.length }, tx);
      await storeRequestResult(tx, UPLOAD_SCOPE, contentKey, { uploadId: uploadRecord.id });

      return {
        uploadId: uploadRecord.id,
        fileName: originalFileName,
        periodStart,
        periodEnd,
        totalRecords: savedRecords.length,
        message: `成功匯入 ${savedRecords.length} 筆打卡紀錄`,
      };
    });
  },
};
