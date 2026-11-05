/**
 * Decides, from one Ragic snapshot and the employees we already have, what a sync should write.
 * Pure: no database, no network. The service reads the inputs and applies the plan in one transaction.
 *
 * Status ownership: Ragic decides an employee's status only when what Ragic implies has changed since the last sync
 * (`observed`); in between, an administrator's edit stands. With no earlier observation Ragic decides, as it always did.
 */
import type { Employee, InsertEmployee } from "@shared/schema";
import { SYNC_ROLES, employeeCodeOf, mapDepartmentToRegionCode, parseRagicRecord, type RagicEmployee } from "./employeeParse";

export type ImpliedStatus = "active" | "inactive";

/** An employee write: the fields Ragic owns, plus `status` only when Ragic has changed its mind. */
export type SyncOp =
  | { kind: "create"; data: InsertEmployee }
  | { kind: "update"; id: number; employeeCode: string; data: Partial<InsertEmployee>; reason: "ragic" | "missing" };

export interface EmployeeSyncPlan {
  ops: SyncOp[];
  /** Employee codes whose implied status differs from the stored observation, with the value to store. */
  observed: Array<{ employeeCode: string; status: ImpliedStatus }>;
  created: number;
  updated: number;
  skipped: number;
  deactivated: number;
  errors: string[];
  skipReasons: Record<string, number>;
  totalFetched: number;
  /** How many distinct employee codes the snapshot lists, blank-name records included. */
  listedCodeCount: number;
}

export interface EmployeeSyncInput {
  records: Record<string, unknown>;
  locals: Employee[];
  regionIdByCode: Map<string, number>;
  observed: Map<string, ImpliedStatus>;
  isValidLineId: (id: string) => boolean;
}

export class SnapshotRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotRejected";
  }
}

/**
 * Throws SnapshotRejected when the snapshot lists no employee code at all. A short list is not rejected: whoever it
 * leaves out is deactivated, however many that is (an administrator's decision, 2026-11-04).
 */
export function assertSnapshotComplete(plan: EmployeeSyncPlan): void {
  if (plan.totalFetched === 0 || plan.listedCodeCount === 0) throw new SnapshotRejected("Ragic 回傳 0 筆有員工編號的記錄，視為不完整的快照，本輪不寫入");
}

const impliedStatus = (parsed: RagicEmployee): ImpliedStatus =>
  SYNC_ROLES.includes(parsed.role) && parsed.status === "active" ? "active" : "inactive";

/** Ragic owns the status when it implies something other than it did last time, or has not been seen before. */
const ragicDecides = (observed: ImpliedStatus | undefined, implied: ImpliedStatus): boolean => observed === undefined || observed !== implied;

export function planEmployeeSync(input: EmployeeSyncInput): EmployeeSyncPlan {
  const { locals, regionIdByCode, observed, isValidLineId } = input;
  const plan: EmployeeSyncPlan = {
    ops: [],
    observed: [],
    created: 0,
    updated: 0,
    skipped: 0,
    deactivated: 0,
    errors: [],
    skipReasons: {},
    totalFetched: Object.keys(input.records).length,
    listedCodeCount: 0,
  };
  const addSkip = (reason: string, n = 1) => {
    plan.skipped += n;
    plan.skipReasons[reason] = (plan.skipReasons[reason] ?? 0) + n;
  };
  const byCode = new Map(locals.map((e) => [e.employeeCode, e]));

  // A code Ragic lists protects its employee from the "missing" rule even when the record has no name.
  const listedCodes = new Set<string>();
  // Several records can share a code; the record with the highest Ragic id (the last one read) decides.
  const latestByCode = new Map<string, RagicEmployee>();
  for (const record of Object.values(input.records)) {
    const code = employeeCodeOf(record as Record<string, any>);
    if (code) listedCodes.add(code);
    const parsed = parseRagicRecord(record as Record<string, any>);
    if (!parsed) {
      addSkip("姓名或員工編號空白");
      continue;
    }
    if (latestByCode.has(parsed.employeeCode)) addSkip("同員工編號有較新的紀錄");
    latestByCode.set(parsed.employeeCode, parsed);
  }

  plan.listedCodeCount = listedCodes.size;

  const observe = (employeeCode: string, status: ImpliedStatus) => {
    if (observed.get(employeeCode) !== status) plan.observed.push({ employeeCode, status });
  };

  for (const parsed of latestByCode.values()) {
    const existing = byCode.get(parsed.employeeCode);
    const implied = impliedStatus(parsed);
    const decides = ragicDecides(observed.get(parsed.employeeCode), implied);

    if (implied === "inactive") {
      if (existing) {
        observe(parsed.employeeCode, "inactive");
        if (existing.status !== "inactive" && decides) {
          plan.ops.push({ kind: "update", id: existing.id, employeeCode: parsed.employeeCode, data: { status: "inactive" }, reason: "ragic" });
          plan.updated++;
          plan.deactivated++;
        }
      } else {
        addSkip(!SYNC_ROLES.includes(parsed.role) ? `職務不在同步範圍(${parsed.rawRole || "空白"})` : `非在職狀態(${parsed.rawStatus || "空白"})`);
      }
      continue;
    }

    const regionCode = mapDepartmentToRegionCode(parsed.department);
    const regionId = regionCode ? regionIdByCode.get(regionCode) : null;

    if (existing) {
      // Ragic fills a field only when it has a value; a blank never clears what is stored (a bound LINE id above all).
      const data: Partial<InsertEmployee> = {};
      if (parsed.name && parsed.name !== existing.name) data.name = parsed.name;
      if (parsed.phone && parsed.phone !== existing.phone) data.phone = parsed.phone;
      if (parsed.email && parsed.email !== existing.email) data.email = parsed.email;
      if (parsed.department && parsed.department !== existing.department) data.department = parsed.department;
      if (parsed.lineId) {
        const incomingValid = isValidLineId(parsed.lineId);
        const existingValid = !!existing.lineId && isValidLineId(existing.lineId);
        if ((incomingValid || !existingValid) && parsed.lineId !== existing.lineId) data.lineId = parsed.lineId;
      }
      if (parsed.employmentType && parsed.employmentType !== existing.employmentType) data.employmentType = parsed.employmentType;
      if (parsed.role && parsed.role !== existing.role) data.role = parsed.role;
      if (regionId && regionId !== existing.regionId) data.regionId = regionId;
      if (existing.status !== "active" && decides) data.status = "active";

      observe(parsed.employeeCode, "active");
      if (Object.keys(data).length > 0) plan.ops.push({ kind: "update", id: existing.id, employeeCode: parsed.employeeCode, data, reason: "ragic" });
      plan.updated++;
    } else {
      if (!regionId) {
        plan.errors.push(`${parsed.name}(${parsed.employeeCode}): 部門「${parsed.department}」無對應區域，跳過新增`);
        addSkip("部門無對應區域");
        continue;
      }
      if (!parsed.employmentType) {
        plan.errors.push(`${parsed.name}(${parsed.employeeCode}): 聘雇類別「${parsed.rawEmploymentType}」不是正職/兼職，跳過新增`);
        addSkip(`聘雇類別未知(${parsed.rawEmploymentType || "空白"})`);
        continue;
      }
      plan.ops.push({
        kind: "create",
        data: {
          name: parsed.name,
          employeeCode: parsed.employeeCode,
          phone: parsed.phone || null,
          email: parsed.email || null,
          lineId: parsed.lineId || null,
          regionId,
          status: "active",
          role: parsed.role,
          employmentType: parsed.employmentType,
          department: parsed.department || null,
        },
      });
      observe(parsed.employeeCode, "active");
      plan.created++;
    }
  }

  // Local active employees of a synced role that Ragic no longer lists. Only a complete snapshot may do this.
  for (const local of locals) {
    if (local.status !== "active" || !SYNC_ROLES.includes(local.role) || listedCodes.has(local.employeeCode)) continue;
    if (!ragicDecides(observed.get(local.employeeCode), "inactive")) continue;
    plan.ops.push({ kind: "update", id: local.id, employeeCode: local.employeeCode, data: { status: "inactive" }, reason: "missing" });
    observe(local.employeeCode, "inactive");
    plan.deactivated++;
  }

  return plan;
}
