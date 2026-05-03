/**
 * Dispatch-shift service.
 *
 * Owns multi-region de-dupe on read, name→employee auto-link on write
 * (single-match active employees only), the batch insert path used by
 * scheduling pages, and the cross-table reconciliation broadcast.
 */
import { storage } from "../../storage";
import { type DispatchShift, type InsertDispatchShift } from "@shared/schema";

const ALLOWED_PATCH_FIELDS = [
  "venueId", "date", "startTime", "endTime",
  "dispatchName", "dispatchCompany", "dispatchPhone",
  "role", "notes", "linkedEmployeeId",
];

async function autoMatchLinkedEmployeeId(name: string, hint?: number | null): Promise<number | null> {
  if (hint != null) return hint;
  if (!name) return null;
  const allEmps = await storage.getAllEmployees();
  const matches = allEmps.filter(
    (e) => e.status === "active" && e.name.trim() === name.trim(),
  );
  return matches.length === 1 ? matches[0].id : null;
}

export const dispatchService = {
  async listByRegionCodes(regionCodeCsv: string, startDate: string, endDate: string): Promise<DispatchShift[]> {
    const codes = regionCodeCsv.split(",").map((c) => c.trim()).filter(Boolean);
    const seen = new Set<number>();
    const out: DispatchShift[] = [];
    for (const code of codes) {
      const region = await storage.getRegionByCode(code);
      if (!region) continue;
      const records = await storage.getDispatchShifts(region.id, startDate, endDate);
      for (const r of records) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    }
    return out;
  },

  async create(payload: any): Promise<DispatchShift> {
    const { regionCode, venueId, date, startTime, endTime, dispatchName, dispatchCompany, dispatchPhone, role, notes, linkedEmployeeId } = payload;
    if (!regionCode || !date || !startTime || !endTime || !dispatchName) {
      const err: any = new Error("缺少必要欄位（區域、日期、時間、派遣人員姓名）");
      err.status = 400;
      throw err;
    }
    const region = await storage.getRegionByCode(regionCode);
    if (!region) {
      const err: any = new Error("找不到區域");
      err.status = 404;
      throw err;
    }
    const resolvedLinkedId = await autoMatchLinkedEmployeeId(dispatchName, linkedEmployeeId);
    return storage.createDispatchShift({
      regionId: region.id,
      venueId: venueId || null,
      date,
      startTime,
      endTime,
      dispatchName,
      dispatchCompany: dispatchCompany || null,
      dispatchPhone: dispatchPhone || null,
      role: role || "救生",
      notes: notes || null,
      linkedEmployeeId: resolvedLinkedId,
    });
  },

  async batchCreate(payload: any) {
    const { regionCode, dates, venueId, startTime, endTime, dispatchName, dispatchCompany, dispatchPhone, role, notes, linkedEmployeeId } = payload;
    if (!regionCode || !dates || !Array.isArray(dates) || dates.length === 0 || !startTime || !endTime || !dispatchName) {
      const err: any = new Error("缺少必要欄位（區域、日期列表、時間、派遣人員姓名）");
      err.status = 400;
      throw err;
    }
    const region = await storage.getRegionByCode(regionCode);
    if (!region) {
      const err: any = new Error("找不到區域");
      err.status = 404;
      throw err;
    }
    const batchLinkedId = await autoMatchLinkedEmployeeId(dispatchName, linkedEmployeeId);
    const inserts: InsertDispatchShift[] = (dates as string[]).map((date) => ({
      regionId: region.id,
      venueId: venueId || null,
      date,
      startTime,
      endTime,
      dispatchName,
      dispatchCompany: dispatchCompany || null,
      dispatchPhone: dispatchPhone || null,
      role: role || "救生",
      notes: notes || null,
      linkedEmployeeId: batchLinkedId,
    }));
    const records = await storage.batchCreateDispatchShifts(inserts);
    return { created: records.length, records };
  },

  async update(id: number, payload: any): Promise<DispatchShift | null | undefined> {
    const existing = await storage.getDispatchShift(id);
    if (!existing) {
      const err: any = new Error("找不到派遣班次");
      err.status = 404;
      throw err;
    }
    const { regionCode, ...rest } = payload;
    const updateData: Record<string, any> = {};
    if (regionCode) {
      const region = await storage.getRegionByCode(regionCode);
      if (!region) {
        const err: any = new Error("找不到區域");
        err.status = 404;
        throw err;
      }
      updateData.regionId = region.id;
    }
    for (const field of ALLOWED_PATCH_FIELDS) {
      if (rest[field] !== undefined) updateData[field] = rest[field];
    }
    if (updateData.dispatchName && updateData.linkedEmployeeId === undefined) {
      const allEmps = await storage.getAllEmployees();
      const matches = allEmps.filter(
        (e) => e.status === "active" && e.name.trim() === (updateData.dispatchName as string).trim(),
      );
      updateData.linkedEmployeeId = matches.length === 1 ? matches[0].id : null;
    }
    return storage.updateDispatchShift(id, updateData);
  },

  remove: (id: number) => storage.deleteDispatchShift(id),

  async reconcileLinks() {
    const updated = await storage.reconcileDispatchLinks();
    return { updated, message: `已自動連結 ${updated} 筆派遣班次` };
  },
};
