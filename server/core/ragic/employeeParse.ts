import { VENUE_TO_REGION } from "./venueData";

export interface RagicEmployee {
  name: string;
  employeeCode: string;
  phone: string;
  email: string;
  lineId: string;
  department: string;
  role: string;
  rawRole: string;
  rawStatus: string;
  rawEmploymentType: string;
  status: string | null;
  employmentType: string | null;
}

export function mapDepartmentToRegionCode(department: string): string | null {
  const cleaned = department.replace(/勞務-/g, "");
  for (const [venue, regionCode] of Object.entries(VENUE_TO_REGION)) {
    if (cleaned.includes(venue)) return regionCode;
  }
  return null;
}

export function mapRole(jobTitle: string): string {
  if (!jobTitle) return "無職";
  if (jobTitle.includes("救生")) return "救生";
  if (jobTitle.includes("守望")) return "守望";
  if (jobTitle.includes("櫃台") || jobTitle.includes("櫃檯") || jobTitle.includes("櫃臺")) return "櫃台";
  if (jobTitle.includes("教練")) return "教練";
  if (jobTitle.includes("機電")) return "機電";
  if (jobTitle.includes("清潔")) return "清潔";
  if (jobTitle.includes("行政專員")) return "行政專員";
  if (jobTitle.includes("資訊工程師")) return "資訊工程師";
  if (jobTitle.includes("主管")) return "主管職";
  if (jobTitle.includes("實習") || jobTitle.includes("在校")) return "在校實習";
  return "無職";
}

export function mapEmploymentType(type: string): string | null {
  if (type === "正職") return "full_time";
  if (type === "兼職") return "part_time";
  return null;
}

export const SYNC_ROLES = ["救生", "守望", "櫃台", "教練"];

const ACTIVE_STATUSES = ["在職"];
const INACTIVE_STATUSES = ["離職", "留職停薪", "合約到期", "退休", "已歿", "資遣", "開除"];

export function mapStatus(status: string): string | null {
  if (!status) return null;
  if (ACTIVE_STATUSES.includes(status)) return "active";
  if (INACTIVE_STATUSES.includes(status)) return "inactive";
  return null;
}

// RAGIC v3 API 每個欄位都可能回傳「單一值」或「多值陣列」。以下兩個工具統一處理，
// 確保「完整讀取整個陣列、再正確取值」，避免陣列被亂轉成 "a,b" 這類髒字串。

// 單值欄位：取陣列中第一個非空值（容忍 ["", "X"] 這種前面夾空值的情況）。
export function firstValue(raw: any): string {
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
    return "";
  }
  return String(raw ?? "").trim();
}

// 多值欄位（部門 / 應徵職務）：完整讀取陣列中所有非空值。
function allValues(raw: any): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  const s = String(raw ?? "").trim();
  return s ? [s] : [];
}

// 以下三個是「手填資料清洗」工具，處理 RAGIC 人工輸入常見的髒值。

// 全形英數標點（U+FF01–U+FF5E）轉半形；全形空白（U+3000）轉半形空白。
function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

// 收斂空白：內部連續空白（含全形/定位/換行/零寬字元）收成單一半形空白，再去頭尾。
// 用於姓名 / 部門 / 應徵職務等「可含詞間空白」的欄位。
function cleanText(s: string): string {
  return s.replace(/[\s\u200b-\u200d\ufeff]+/g, " ").trim();
}

// 整理為「無空白 token」：全形轉半形 + 去除所有空白與零寬字元。
// 用於不該含空白的欄位：手機 / E-mail / LINE ID / 聘雇類別 / 在職狀態。
function tidyToken(s: string): string {
  return toHalfWidth(s).replace(/[\s\u200b-\u200d\ufeff]+/g, "");
}

/** The match key of a record, available even when the name is blank. */
export function employeeCodeOf(record: Record<string, any>): string {
  return firstValue(record["員工編號"]);
}

export function parseRagicRecord(record: Record<string, any>): RagicEmployee | null {
  // 單值欄位：取陣列第一個非空值。
  // 員工編號是比對鍵 → 只去頭尾空白（不做內部清洗），避免清洗後對不到既有資料而重複新增。
  const name = cleanText(firstValue(record["姓名"]));
  const employeeCode = employeeCodeOf(record);
  if (!name || !employeeCode) return null;

  // 多值欄位：完整讀取所有值、逐一清洗後 join，供 mapRole / mapDepartmentToRegionCode 比對
  //（兩者皆以 includes 比對，因此能對應到陣列中的任一個值）。
  const department = allValues(record["部門"]).map(cleanText).filter(Boolean).join(", ");
  const roleStr = allValues(record["應徵職務"]).map(cleanText).filter(Boolean).join(", ");

  // 聘雇類別 / 在職狀態為精確比對欄位，去除所有空白以確保 mapStatus / mapEmploymentType 命中。
  const typeStr = tidyToken(firstValue(record["聘雇類別"]));
  const statusStr = tidyToken(firstValue(record["在職狀態"]));

  return {
    name,
    employeeCode,
    phone: tidyToken(firstValue(record["手機"])),
    email: tidyToken(firstValue(record["電子郵件信箱"])), // RAGIC 實際 key 為「電子郵件信箱」（非 E-mail，舊 key 不存在導致 email 全空）
    lineId: tidyToken(firstValue(record["個人LINE ID"])),
    department,
    role: mapRole(roleStr),
    rawRole: roleStr,
    rawStatus: statusStr,
    rawEmploymentType: typeStr,
    status: mapStatus(statusStr),
    employmentType: mapEmploymentType(typeStr),
  };
}

