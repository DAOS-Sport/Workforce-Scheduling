/**
 * server/infra/excel/excelParser.ts
 *
 * Low-level ExcelJS helpers shared across import modules.
 * Provides cell-value resolution utilities so every route that parses
 * XLSX files uses the same coercion rules.
 *
 * Domain-specific parsing logic (e.g. attendance import) lives in
 * server/modules/importExport/ and uses these primitives.
 */
import ExcelJS from "exceljs";

/**
 * Normalise a raw ExcelJS cell value to a plain JavaScript primitive.
 * Handles: null/undefined, Date, rich-text, formula results, hyperlinks.
 */
export function resolveCellValue(v: unknown): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if ("richText" in obj && Array.isArray(obj.richText))
      return (obj.richText as { text?: unknown }[])
        .map((r) => r.text ?? "")
        .join("")
        .trim();
    if ("result" in obj) return resolveCellValue(obj.result);
    if ("text" in obj) return String(obj.text).trim();
    if ("hyperlink" in obj && "text" in obj) return String(obj.text).trim();
  }
  return v;
}

/**
 * Load an XLSX buffer and return an ExcelJS Workbook.
 */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/**
 * Extract all rows from a worksheet as plain arrays (1-indexed offset removed).
 */
export function extractRows(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[];
    const rowData = Array.from(
      { length: Math.max(values.length - 1, 0) },
      (_, i) => resolveCellValue(values[i + 1]),
    );
    rows.push(rowData);
  });
  return rows;
}
