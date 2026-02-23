import { storage } from "./storage";

const RAGIC_API_URL = "https://ap7.ragic.com/xinsheng/ragicforms4/13";

interface RagicEmployee {
  name: string;
  employeeCode: string;
  phone: string;
  email: string;
  lineId: string;
  department: string;
  role: string | null;
  rawRole: string;
  rawStatus: string;
  status: string | null;
  employmentType: string;
}

const VENUE_TO_REGION: Record<string, string> = {
  "新北高中": "A",
  "三民高中": "A",
  "三重商工": "A",
  "松山國小": "B",
  "新竹科學園區": "C",
};

function mapDepartmentToRegionCode(department: string): string | null {
  for (const [venue, regionCode] of Object.entries(VENUE_TO_REGION)) {
    if (department.includes(venue)) return regionCode;
  }
  return null;
}

function mapRole(jobTitle: string): string | null {
  if (!jobTitle) return null;
  if (jobTitle.includes("救生") || jobTitle.includes("守望")) return "救生";
  if (jobTitle.includes("櫃台") || jobTitle.includes("櫃檯")) return "櫃台";
  if (jobTitle.includes("教練")) return "救生";
  if (jobTitle.includes("行政")) return "櫃台";
  if (jobTitle.includes("清潔") || jobTitle.includes("主管") || jobTitle.includes("資訊")) return null;
  return null;
}

function mapEmploymentType(type: string): string {
  if (type === "正職") return "full_time";
  if (type === "兼職") return "part_time";
  return "full_time";
}

const ACTIVE_STATUSES = ["在職", "試用"];
const INACTIVE_STATUSES = ["離職", "留職停薪", "留停", "停職", "合約到期", "退休", "開除", "資遣"];

function mapStatus(status: string): string | null {
  if (!status) return null;
  if (ACTIVE_STATUSES.includes(status)) return "active";
  for (const inactive of INACTIVE_STATUSES) {
    if (status.includes(inactive)) return "inactive";
  }
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

      if (parsed.status === null) {
        result.errors.push(`${parsed.name}(${parsed.employeeCode}): 無法辨識在職狀態「${parsed.rawStatus}」，跳過不處理`);
        result.skipped++;
        continue;
      }

      const regionCode = mapDepartmentToRegionCode(parsed.department);
      const regionId = regionCode ? regionMap.get(regionCode) : null;

      const existing = await storage.getEmployeeByCode(parsed.employeeCode);
      const isActive = parsed.status === "active";

      if (existing) {
        const updateData: Record<string, any> = {
          name: parsed.name,
          status: parsed.status,
          phone: parsed.phone || null,
          email: parsed.email || null,
          lineId: parsed.lineId || null,
          employmentType: parsed.employmentType,
        };
        if (parsed.role) updateData.role = parsed.role;
        if (regionId) updateData.regionId = regionId;
        await storage.updateEmployee(existing.id, updateData);
        result.updated++;
        if (!isActive && existing.status === "active") {
          result.deactivated++;
        }
      } else if (isActive) {
        if (!parsed.role) {
          result.errors.push(`${parsed.name}(${parsed.employeeCode}): 職務「${parsed.rawRole}」無法對應系統角色，跳過新增`);
          result.skipped++;
          continue;
        }
        if (!regionId) {
          result.errors.push(`${parsed.name}(${parsed.employeeCode}): 無法辨識部門「${parsed.department}」的所屬區域`);
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
          status: parsed.status,
          role: parsed.role,
          employmentType: parsed.employmentType,
        });
        result.created++;
      } else {
        result.skipped++;
      }
    } catch (err: any) {
      result.errors.push(`Record ${ragicId}: ${err.message}`);
    }
  }

  return result;
}
