import { storage } from "./storage";

const RAGIC_API_URL = "https://ap7.ragic.com/xinsheng/ragicforms4/20004";

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
  "新北高中": { region: "A", address: "新北市三重區三信路1號", lat: 25.0712, lng: 121.4956, taxId: "85300099", isInternal: false, operationType: "OT" },
  "三民高中": { region: "A", address: "新北市蘆洲區三民路60號", lat: 25.0834, lng: 121.4789, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "三重商工": { region: "A", address: "新北市三重區中正北路163號", lat: 25.0645, lng: 121.4873, taxId: "85184649", isInternal: false, operationType: "OT" },
  "新莊國中": { region: "A", address: "新北市新莊區中正路211號", lat: 25.0358, lng: 121.4520, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "松山國小": { region: "B", address: "台北市松山區八德路四段746號", lat: 25.0498, lng: 121.5785, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
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
  if (jobTitle.includes("櫃台") || jobTitle.includes("櫃檯")) return "櫃台";
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

function parseRagicRecord(record: Record<string, any>): RagicEmployee | null {
  const rawName = record["姓名"];
  const rawCode = record["員工編號"];
  const name = Array.isArray(rawName) ? rawName[0] : rawName;
  const employeeCode = Array.isArray(rawCode) ? rawCode[0] : rawCode;
  if (!name || !employeeCode) return null;

  const rawDept = record["部門"];
  const department = Array.isArray(rawDept) ? rawDept.join(", ") : String(rawDept || "");
  const rawRole = record["應徵職務"];
  const roleStr = Array.isArray(rawRole) ? rawRole.join(", ") : String(rawRole || "");
  const rawType = record["聘雇類別"];
  const typeStr = Array.isArray(rawType) ? rawType[0] || "" : String(rawType || "");
  const rawStatusField = record["在職狀態"];
  const statusStr = Array.isArray(rawStatusField) ? rawStatusField[0] || "" : String(rawStatusField || "");

  return {
    name: name.trim(),
    employeeCode: String(employeeCode).trim(),
    phone: String(record["手機"] || "").trim(),
    email: String(record["E-mail"] || "").trim(),
    lineId: String(record["個人LINE ID"] || "").trim(),
    department: department.trim(),
    role: mapRole(roleStr.trim()),
    rawRole: roleStr.trim(),
    rawStatus: statusStr.trim(),
    rawEmploymentType: typeStr.trim(),
    status: mapStatus(statusStr.trim()),
    employmentType: mapEmploymentType(typeStr.trim()),
  };
}

export async function syncFromRagic(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  deactivated: number;
  errors: string[];
}> {
  const apiKey = process.env.RAGIC_API_KEY;
  if (!apiKey) throw new Error("RAGIC_API_KEY not configured");

  const result = { created: 0, updated: 0, skipped: 0, deactivated: 0, errors: [] as string[] };

  const params = new URLSearchParams({
    v: "3",
    limit: "1000",
    _: String(Date.now()),
  });
  const response = await fetch(`${RAGIC_API_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`Ragic API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const regions = await storage.getRegions();
  const regionMap = new Map(regions.map((r) => [r.code, r.id]));

  for (const [ragicId, record] of Object.entries(data)) {
    try {
      const parsed = parseRagicRecord(record as Record<string, any>);
      if (!parsed) {
        result.skipped++;
        continue;
      }

      if (!SYNC_ROLES.includes(parsed.role)) {
        result.skipped++;
        continue;
      }

      if (!ACTIVE_STATUSES.includes(parsed.rawStatus)) {
        result.skipped++;
        continue;
      }

      const regionCode = mapDepartmentToRegionCode(parsed.department);
      const regionId = regionCode ? regionMap.get(regionCode) : null;

      const existing = await storage.getEmployeeByCode(parsed.employeeCode);

      if (existing) {
        const updateData: Record<string, any> = {};
        if (parsed.name) updateData.name = parsed.name;
        updateData.status = parsed.status;
        if (parsed.phone) updateData.phone = parsed.phone;
        if (parsed.email) updateData.email = parsed.email;
        if (parsed.lineId) updateData.lineId = parsed.lineId;
        if (parsed.employmentType) updateData.employmentType = parsed.employmentType;
        if (parsed.role) updateData.role = parsed.role;
        if (regionId) updateData.regionId = regionId;
        await storage.updateEmployee(existing.id, updateData);
        result.updated++;
      } else {
        if (!regionId) {
          result.errors.push(`${parsed.name}(${parsed.employeeCode}): 部門「${parsed.department}」無對應區域，跳過新增`);
          result.skipped++;
          continue;
        }
        if (!parsed.employmentType) {
          result.errors.push(`${parsed.name}(${parsed.employeeCode}): 聘雇類別「${parsed.rawEmploymentType}」不是正職/兼職，跳過新增`);
          result.skipped++;
          continue;
        }
        await storage.createEmployee({
          name: parsed.name,
          employeeCode: parsed.employeeCode,
          phone: parsed.phone || null,
          email: parsed.email || null,
          lineId: parsed.lineId || null,
          regionId,
          status: parsed.status!,
          role: parsed.role,
          employmentType: parsed.employmentType,
        });
        result.created++;
      }
    } catch (err: any) {
      result.errors.push(`Record ${ragicId}: ${err.message}`);
    }
  }

  return result;
}

export async function syncVenuesFromRagic(): Promise<{
  created: number;
  existing: number;
  skipped: number;
  errors: string[];
}> {
  const apiKey = process.env.RAGIC_API_KEY;
  if (!apiKey) throw new Error("RAGIC_API_KEY not configured");

  const result = { created: 0, existing: 0, skipped: 0, errors: [] as string[] };

  const params = new URLSearchParams({
    v: "3",
    limit: "1000",
    _: String(Date.now()),
  });
  const response = await fetch(`${RAGIC_API_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Basic ${apiKey}`,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`Ragic API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
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
        latitude: venueInfo.lat,
        longitude: venueInfo.lng,
        taxId: venueInfo.taxId,
        isInternal: venueInfo.isInternal,
        operationType: opType || null,
      });
      result.created++;
    } catch (err: any) {
      result.errors.push(`${dept}: ${err.message}`);
    }
  }

  return result;
}
