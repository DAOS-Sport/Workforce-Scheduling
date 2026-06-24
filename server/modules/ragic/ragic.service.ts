import { storage } from "../../storage";
import { fetchAllRagicRecords } from "./ragicClient";
import { isValidLineUserId } from "../line/lineSignature";

// Task #50 NOTE: This module currently only syncs employees + venues.
// If shift sync is ever added here, all writes MUST:
//   1. Pass actor='system:ragic-sync' to storage.create/update/deleteShift
//   2. Pass force=false (or omit) so active shifts are never silently overwritten
// The storage guard will throw on (non-admin actor + active shift + !force).

interface RagicEmployee {
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

interface VenueInfo {
  region: string;
  address: string;
  lat: number;
  lng: number;
  taxId: string;
  isInternal: boolean;
  operationType: string;
}

const HQ_ADDRESS = "新北市永和區秀朗路2段148巷5弄13號4樓";
const HQ_LAT = 25.0082;
const HQ_LNG = 121.5133;
const COMPANY_TAX_ID = "66601546";

const VENUE_DATA: Record<string, VenueInfo> = {
  "新北高中": { region: "A", address: "新北市三重區三信路1號", lat: 25.08725005030422, lng: 121.49125601819283, taxId: "85300099", isInternal: false, operationType: "OT" },
  "三民高中": { region: "A", address: "新北市蘆洲區三民路96號", lat: 25.08647850866701, lng: 121.4742795576005, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "三重商工": { region: "A", address: "新北市三重區中正北路163號", lat: 25.068783172507857, lng: 121.48241151452356, taxId: "85184649", isInternal: false, operationType: "OT" },
  "新莊國中": { region: "A", address: "新北市新莊區中正路211號", lat: 25.0358, lng: 121.4520, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "松山國小": { region: "B", address: "台北市松山區八德路四段746號", lat: 25.050835631078957, lng: 121.57794212990194, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "國防醫學大學": { region: "B", address: "台北市內湖區民權東路六段161號", lat: 25.0640, lng: 121.6076, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "士東國小": { region: "B", address: "台北市士林區中山北路六段392號", lat: 25.1110, lng: 121.5275, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "大湖國小": { region: "B", address: "台北市內湖區大湖山莊街170號", lat: 25.0832, lng: 121.6016, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "溪口國小": { region: "B", address: "台北市文山區景福街225號", lat: 24.9893, lng: 121.5391, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "建成國中": { region: "B", address: "台北市大同區長安西路37-1號", lat: 25.0513, lng: 121.5212, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "士林國小": { region: "B", address: "台北市士林區大東路165號", lat: 25.0937, lng: 121.5253, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "義方國小": { region: "B", address: "台北市北投區珠海路155號", lat: 25.1326, lng: 121.5065, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "百齡高中": { region: "B", address: "台北市士林區承德路四段177號", lat: 25.0867, lng: 121.5213, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "清江國小": { region: "B", address: "台北市北投區公館路220號", lat: 25.1218, lng: 121.5029, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "福林國小": { region: "B", address: "台北市士林區福志路75號", lat: 25.0979, lng: 121.5249, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "明倫高中": { region: "B", address: "台北市大同區承德路三段336號", lat: 25.0700, lng: 121.5180, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "民生國中": { region: "B", address: "台北市松山區新東街30巷1號", lat: 25.0584, lng: 121.5639, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "永吉國中": { region: "B", address: "台北市信義區松隆路161號", lat: 25.0428, lng: 121.5708, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "西湖國中": { region: "B", address: "台北市內湖區環山路一段27號", lat: 25.0786, lng: 121.5651, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "陽明高中": { region: "B", address: "台北市士林區中正路510號", lat: 25.0930, lng: 121.5167, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "台灣科技大學": { region: "B", address: "台北市大安區基隆路四段43號", lat: 25.0127, lng: 121.5416, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "新竹科學園區": { region: "C", address: "新竹市東區新安路2號", lat: 24.7862, lng: 120.9976, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "新屋高中": { region: "C", address: "桃園市新屋區中興路111號", lat: 24.9722, lng: 121.1061, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "駿斯運動事業股份有限公司": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
  "人力資源處": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
  "數位轉型發展處": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
  "營運管理處": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
  "行銷事業處": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
};

const VENUE_TO_REGION: Record<string, string> = Object.fromEntries(
  Object.entries(VENUE_DATA).map(([k, v]) => [k, v.region])
);

function mapDepartmentToRegionCode(department: string): string | null {
  const cleaned = department.replace(/勞務-/g, "");
  for (const [venue, regionCode] of Object.entries(VENUE_TO_REGION)) {
    if (cleaned.includes(venue)) return regionCode;
  }
  return null;
}

function mapRole(jobTitle: string): string {
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

function mapEmploymentType(type: string): string | null {
  if (type === "正職") return "full_time";
  if (type === "兼職") return "part_time";
  return null;
}

const SYNC_ROLES = ["救生", "守望", "櫃台"];

const ACTIVE_STATUSES = ["在職"];
const INACTIVE_STATUSES = ["離職", "留職停薪", "合約到期", "退休", "已歿", "資遣", "開除"];

function mapStatus(status: string): string | null {
  if (!status) return null;
  if (ACTIVE_STATUSES.includes(status)) return "active";
  if (INACTIVE_STATUSES.includes(status)) return "inactive";
  return null;
}

// RAGIC v3 API 每個欄位都可能回傳「單一值」或「多值陣列」。以下兩個工具統一處理，
// 確保「完整讀取整個陣列、再正確取值」，避免陣列被亂轉成 "a,b" 這類髒字串。

// 單值欄位：取陣列中第一個非空值（容忍 ["", "X"] 這種前面夾空值的情況）。
function firstValue(raw: any): string {
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

function parseRagicRecord(record: Record<string, any>): RagicEmployee | null {
  // 單值欄位：取陣列第一個非空值。
  // 員工編號是比對鍵 → 只去頭尾空白（不做內部清洗），避免清洗後對不到既有資料而重複新增。
  const name = cleanText(firstValue(record["姓名"]));
  const employeeCode = firstValue(record["員工編號"]);
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

async function deactivateLocalEmployeesMissingFromRagic(
  ragicEmployeeCodes: Set<string>,
  dryRun: boolean,
): Promise<number> {
  if (ragicEmployeeCodes.size === 0) return 0;

  const localEmployees = await storage.getAllEmployees();
  let deactivated = 0;

  for (const employee of localEmployees) {
    if (employee.status !== "active") continue;
    if (!SYNC_ROLES.includes(employee.role)) continue;
    if (ragicEmployeeCodes.has(employee.employeeCode)) continue;

    if (!dryRun) await storage.updateEmployee(employee.id, { status: "inactive" });
    deactivated++;
  }

  return deactivated;
}

export async function syncFromRagic(dryRun = false): Promise<{
  created: number;
  updated: number;
  skipped: number;
  deactivated: number;
  errors: string[];
  skipReasons: Record<string, number>;
  totalFetched: number;
}> {
  const apiKey = process.env.RAGIC_API_KEY;
  if (!apiKey) throw new Error("RAGIC_API_KEY not configured");

  const result = {
    created: 0,
    updated: 0,
    skipped: 0,
    deactivated: 0,
    errors: [] as string[],
    skipReasons: {} as Record<string, number>,
    totalFetched: 0,
  };

  function addSkip(reason: string) {
    result.skipped++;
    result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
  }

  const data = await fetchAllRagicRecords(apiKey);
  result.totalFetched = Object.keys(data).length;
  console.log(`[ragic] 共拉取 ${result.totalFetched} 筆原始記錄，開始處理...`);

  const regions = await storage.getRegions();
  const regionMap = new Map(regions.map((r) => [r.code, r.id]));
  const ragicEmployeeCodes = new Set<string>();

  for (const [ragicId, record] of Object.entries(data)) {
    try {
      const parsed = parseRagicRecord(record as Record<string, any>);
      if (!parsed) {
        addSkip("姓名或員工編號空白");
        continue;
      }
      ragicEmployeeCodes.add(parsed.employeeCode);

      if (!SYNC_ROLES.includes(parsed.role)) {
        addSkip(`職務不在同步範圍(${parsed.rawRole || "空白"})`);
        continue;
      }

      const regionCode = mapDepartmentToRegionCode(parsed.department);
      const regionId = regionCode ? regionMap.get(regionCode) : null;

      const existing = await storage.getEmployeeByCode(parsed.employeeCode);

      if (existing) {
        // 更新策略：RAGIC 有值才覆寫，空白不清（避免把本地資料/已綁定 LINE ID 清掉）。
        const updateData: Record<string, any> = {};
        if (parsed.name) updateData.name = parsed.name;
        if (parsed.phone) updateData.phone = parsed.phone;
        if (parsed.email) updateData.email = parsed.email;
        if (parsed.department) updateData.department = parsed.department;
        // LINE ID：保護已綁定的有效 ID — 僅在「RAGIC 新值為有效 U 格式」或「本地現值無效」
        // 時才覆寫；RAGIC 為空則完全不動 lineId，不會把員工登入用的 ID 清掉。
        if (parsed.lineId) {
          const incomingValid = isValidLineUserId(parsed.lineId);
          const existingValid = existing.lineId && isValidLineUserId(existing.lineId);
          if (incomingValid || !existingValid) {
            updateData.lineId = parsed.lineId;
          }
        }
        if (parsed.employmentType) updateData.employmentType = parsed.employmentType;
        if (parsed.role) updateData.role = parsed.role;
        if (regionId) updateData.regionId = regionId;

        if (parsed.status) {
          updateData.status = parsed.status;
          if (parsed.status === "inactive" && existing.status !== "inactive") {
            result.deactivated++;
          }
        } else if (parsed.rawStatus && INACTIVE_STATUSES.includes(parsed.rawStatus)) {
          updateData.status = "inactive";
          if (existing.status !== "inactive") {
            result.deactivated++;
          }
        }

        if (!dryRun) await storage.updateEmployee(existing.id, updateData);
        result.updated++;
      } else {
        if (!ACTIVE_STATUSES.includes(parsed.rawStatus)) {
          addSkip(`非在職狀態(${parsed.rawStatus || "空白"})`);
          continue;
        }
        if (!regionId) {
          result.errors.push(`${parsed.name}(${parsed.employeeCode}): 部門「${parsed.department}」無對應區域，跳過新增`);
          addSkip("部門無對應區域");
          continue;
        }
        if (!parsed.employmentType) {
          result.errors.push(`${parsed.name}(${parsed.employeeCode}): 聘雇類別「${parsed.rawEmploymentType}」不是正職/兼職，跳過新增`);
          addSkip(`聘雇類別未知(${parsed.rawEmploymentType || "空白"})`);
          continue;
        }
        if (!dryRun) await storage.createEmployee({
          name: parsed.name,
          employeeCode: parsed.employeeCode,
          phone: parsed.phone || null,
          email: parsed.email || null,
          lineId: parsed.lineId || null,
          regionId,
          status: parsed.status!,
          role: parsed.role,
          employmentType: parsed.employmentType,
          department: parsed.department || null,
        });
        result.created++;
      }
    } catch (err: any) {
      result.errors.push(`Record ${ragicId}: ${err.message}`);
    }
  }

  const missingDeactivated = await deactivateLocalEmployeesMissingFromRagic(ragicEmployeeCodes, dryRun);
  result.deactivated += missingDeactivated;

  console.log(`[ragic] ${dryRun ? "[預覽] " : ""}同步完成 — 新增:${result.created} 更新:${result.updated} 略過:${result.skipped} 停用:${result.deactivated} 錯誤:${result.errors.length}`);
  if (Object.keys(result.skipReasons).length > 0) {
    console.log(`[ragic] 略過原因:`, result.skipReasons);
  }

  return result;
}

export async function syncVenuesFromRagic(): Promise<{
  created: number;
  existing: number;
  skipped: number;
  errors: string[];
  updated: number;
}> {
  const apiKey = process.env.RAGIC_API_KEY;
  if (!apiKey) throw new Error("RAGIC_API_KEY not configured");

  const result = { created: 0, existing: 0, skipped: 0, errors: [] as string[], updated: 0 };

  const data = await fetchAllRagicRecords(apiKey);
  console.log(`[ragic-venue] 共拉取 ${Object.keys(data).length} 筆原始記錄`);

  const regions = await storage.getRegions();
  const regionMap = new Map(regions.map((r) => [r.code, r.id]));

  const allVenues = await Promise.all(regions.map((r) => storage.getVenuesByRegion(r.id)));
  const existingVenueNames = new Set(allVenues.flat().map((v) => v.name.replace(/館$/, "")));

  const deptMap = new Map<string, string>();
  for (const record of Object.values(data)) {
    const rawDept = (record as any)["部門"];
    const depts = Array.isArray(rawDept) ? rawDept : [String(rawDept || "")];
    const rawOpType = (record as any)["1002826"];
    const opType = Array.isArray(rawOpType) ? (rawOpType[0] || "").trim() : String(rawOpType || "").trim();
    depts.forEach((d: string) => {
      const dt = d.trim();
      if (dt && opType && !deptMap.has(dt)) deptMap.set(dt, opType);
      if (dt && !deptMap.has(dt)) deptMap.set(dt, "");
    });
  }

  for (const [dept, ragicOpType] of Array.from(deptMap.entries())) {
    const venueName = dept.startsWith("勞務-") ? dept.replace("勞務-", "") : dept;

    if (existingVenueNames.has(venueName) || existingVenueNames.has(venueName.replace(/館$/, ""))) {
      result.existing++;
      continue;
    }

    const venueInfo = VENUE_DATA[venueName];
    if (!venueInfo) {
      result.errors.push(`${dept}: 無對應資料，跳過新增`);
      result.skipped++;
      continue;
    }

    const regionId = regionMap.get(venueInfo.region);
    if (!regionId) {
      result.errors.push(`${dept}: 區域代碼「${venueInfo.region}」不存在`);
      result.skipped++;
      continue;
    }

    try {
      const opType = ragicOpType || venueInfo.operationType;
      await storage.createVenue({
        name: venueName,
        shortName: venueName,
        regionId,
        address: venueInfo.address,
        latitude: null,
        longitude: null,
        taxId: venueInfo.taxId,
        isInternal: venueInfo.isInternal,
        operationType: opType || null,
      });
      result.created++;
    } catch (err: any) {
      result.errors.push(`${dept}: ${err.message}`);
    }
  }

  console.log(`[ragic-venue] 場館同步完成 — 新增:${result.created} 已存在:${result.existing} 略過:${result.skipped} 錯誤:${result.errors.length}`);
  return result;
}
