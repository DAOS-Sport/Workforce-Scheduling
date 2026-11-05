import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attendanceRecords, attendanceUploads, idempotencyKeys } from "@shared/schema";
import { db } from "../../infra/db";
import { concurrently, resetDatabase, warmPool } from "../../test/itest";
import { attendanceService } from "../attendance/attendance.service";
import { importExportService } from "./importExport.service";

const HEADERS = ["員工編號", "姓名", "部門", "打卡日期", "上班打卡時間", "下班打卡時間"];
const SHEET = "打卡紀錄2026.07.01-2026.07.31";

const row = (i: number, over: Partial<Record<"code" | "date", string>> = {}) => [
  over.code ?? `E${String(i).padStart(4, "0")}`,
  `測試員工${i}`,
  "測試部",
  over.date ?? `2026/07/${String((i % 28) + 1).padStart(2, "0")}`,
  "09:00",
  "18:00",
];

async function xlsx(rows: string[][], sheetName = SHEET): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

const counts = async () => ({
  uploads: (await db.select().from(attendanceUploads)).length,
  records: (await db.select().from(attendanceRecords)).length,
  keys: (await db.select().from(idempotencyKeys)).length,
});

/** Make the database itself refuse one write, so a failure lands in the middle of the real statements. */
async function failWhen(table: string, event: "insert" | "delete", condition: string) {
  await db.execute(sql.raw(`create or replace function itest_fail() returns trigger language plpgsql as $$ begin raise exception 'itest: forced failure'; end $$`));
  await db.execute(sql.raw(`create trigger itest_fail before ${event} on ${table} for each row when (${condition}) execute function itest_fail()`));
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await db.execute(sql.raw(`drop trigger if exists itest_fail on attendance_records`));
  await db.execute(sql.raw(`drop trigger if exists itest_fail on attendance_uploads`));
});

describe("attendance XLSX import (T23)", () => {
  it("writes one upload holding every row, with the period from the sheet name", async () => {
    const result = await importExportService.importAttendanceXlsx(await xlsx(rowsOf(250)), "七月.xlsx");

    const [upload] = await db.select().from(attendanceUploads);
    expect([result.totalRecords, upload.totalRecords, upload.periodStart, upload.periodEnd]).toEqual([250, 250, "2026-07-01", "2026-07-31"]);
    expect((await counts()).records).toBe(250);
  });

  it("a sheet name without a period takes the period from the rows, not a fixed January", async () => {
    const result = await importExportService.importAttendanceXlsx(await xlsx([row(1, { date: "2026/07/03" }), row(2, { date: "2026/07/09" })], "打卡紀錄"), "x.xlsx");

    const [upload] = await db.select().from(attendanceUploads);
    expect([upload.periodStart, upload.periodEnd, result.periodStart, result.periodEnd]).toEqual(["2026-07-03", "2026-07-09", "2026-07-03", "2026-07-09"]);
  });

  it("a row whose date cannot be read refuses the whole file with 400 and writes nothing", async () => {
    const rows = rowsOf(150);
    rows[120] = row(121, { date: "七月六日" });

    const error: any = await importExportService.importAttendanceXlsx(await xlsx(rows), "x.xlsx").catch((e) => e);

    expect(error.status).toBe(400);
    expect(error.message).toContain("第 122 列");
    expect(await counts()).toEqual({ uploads: 0, records: 0, keys: 0 });
  });

  it("a failure in the third batch of 100 leaves nothing in uploads, records or request keys", async () => {
    const rows = rowsOf(250);
    rows[230] = row(231, { code: "BOOM" });
    await failWhen("attendance_records", "insert", "new.employee_code = 'BOOM'");

    const error: any = await importExportService.importAttendanceXlsx(await xlsx(rows), "x.xlsx").catch((e) => e);

    expect(error.message).toContain("itest: forced failure");
    expect(await counts()).toEqual({ uploads: 0, records: 0, keys: 0 });
  });

  it("the same file uploaded again is refused with 409 and nothing is added", async () => {
    const file = await xlsx(rowsOf(30));
    const first = await importExportService.importAttendanceXlsx(file, "x.xlsx");

    const error: any = await importExportService.importAttendanceXlsx(file, "x-copy.xlsx").catch((e) => e);

    expect(error.status).toBe(409);
    expect(error.message).toContain(String(first.uploadId));
    expect(await counts()).toEqual({ uploads: 1, records: 30, keys: 1 });
  });

  it("the same file uploaded twice at the same moment is stored once", async () => {
    const file = await xlsx(rowsOf(30));
    await warmPool(4);

    const results = await concurrently(2, () => importExportService.importAttendanceXlsx(file, "x.xlsx"));

    expect(results.map((r) => (r.status === "fulfilled" ? 200 : (r.reason as any).status)).sort()).toEqual([200, 409]);
    expect(await counts()).toEqual({ uploads: 1, records: 30, keys: 1 });
  });

  it("after its upload is deleted, the same file can be imported again", async () => {
    const file = await xlsx(rowsOf(30));
    const first = await importExportService.importAttendanceXlsx(file, "x.xlsx");
    await attendanceService.deleteUpload(first.uploadId);

    const again = await importExportService.importAttendanceXlsx(file, "x.xlsx");

    expect(again.uploadId).not.toBe(first.uploadId);
    expect(await counts()).toEqual({ uploads: 1, records: 30, keys: 1 });
  });
});

describe("deleting an attendance upload (T22)", () => {
  it("removes the upload and its records", async () => {
    const { uploadId } = await importExportService.importAttendanceXlsx(await xlsx(rowsOf(30)), "x.xlsx");

    expect(await attendanceService.deleteUpload(uploadId)).toBe(true);

    expect((await counts()).uploads + (await counts()).records).toBe(0);
  });

  it("when removing the upload row fails, its records are all still there", async () => {
    const { uploadId } = await importExportService.importAttendanceXlsx(await xlsx(rowsOf(30)), "x.xlsx");
    await failWhen("attendance_uploads", "delete", "true");

    const error: any = await attendanceService.deleteUpload(uploadId).catch((e) => e);

    expect(error.message).toContain("itest: forced failure");
    expect(await counts()).toMatchObject({ uploads: 1, records: 30 });
  });
});
