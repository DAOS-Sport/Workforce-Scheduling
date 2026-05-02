import { type Express } from "express";
import { type Server } from "http";
import { storage } from "../../storage";
import { type DispatchShift } from "@shared/schema";
import { count } from "drizzle-orm";

export function mountDispatchRoutes(httpServer: Server, app: Express): void {
  app.get("/api/dispatch-shifts/:regionCode/:startDate/:endDate", async (req, res) => {
  try {
    const { regionCode, startDate, endDate } = req.params;
    const codes = regionCode.split(",").map(c => c.trim()).filter(Boolean);
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
    res.json(out);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/dispatch-shifts", async (req, res) => {
  try {
    const { regionCode, venueId, date, startTime, endTime, dispatchName, dispatchCompany, dispatchPhone, role, notes, linkedEmployeeId } = req.body;
    if (!regionCode || !date || !startTime || !endTime || !dispatchName) {
      return res.status(400).json({ message: "缺少必要欄位（區域、日期、時間、派遣人員姓名）" });
    }
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.status(404).json({ message: "找不到區域" });
    let resolvedLinkedId: number | null = linkedEmployeeId || null;
    if (!resolvedLinkedId && dispatchName) {
      const allEmps = await storage.getAllEmployees();
      const matches = allEmps.filter(e => e.status === "active" && e.name.trim() === dispatchName.trim());
      if (matches.length === 1) resolvedLinkedId = matches[0].id;
    }
    const record = await storage.createDispatchShift({
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
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/dispatch-shifts/batch-create", async (req, res) => {
  try {
    const { regionCode, dates, venueId, startTime, endTime, dispatchName, dispatchCompany, dispatchPhone, role, notes, linkedEmployeeId } = req.body;
    if (!regionCode || !dates || !Array.isArray(dates) || dates.length === 0 || !startTime || !endTime || !dispatchName) {
      return res.status(400).json({ message: "缺少必要欄位（區域、日期列表、時間、派遣人員姓名）" });
    }
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return res.status(404).json({ message: "找不到區域" });
    let batchLinkedId: number | null = linkedEmployeeId || null;
    if (!batchLinkedId && dispatchName) {
      const allEmps = await storage.getAllEmployees();
      const matches = allEmps.filter(e => e.status === "active" && e.name.trim() === dispatchName.trim());
      if (matches.length === 1) batchLinkedId = matches[0].id;
    }
    const inserts = (dates as string[]).map((date) => ({
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
    res.json({ created: records.length, records });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/dispatch-shifts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await storage.getDispatchShift(id);
    if (!existing) return res.status(404).json({ message: "找不到派遣班次" });
    const { regionCode, ...rest } = req.body;
    const updateData: Record<string, any> = {};
    if (regionCode) {
      const region = await storage.getRegionByCode(regionCode);
      if (!region) return res.status(404).json({ message: "找不到區域" });
      updateData.regionId = region.id;
    }
    const allowedFields = ["venueId", "date", "startTime", "endTime", "dispatchName", "dispatchCompany", "dispatchPhone", "role", "notes", "linkedEmployeeId"];
    for (const field of allowedFields) {
      if (rest[field] !== undefined) updateData[field] = rest[field];
    }
    // 若更新了姓名且未提供 linkedEmployeeId，自動比對員工（僅唯一比對才設定）
    if (updateData.dispatchName && updateData.linkedEmployeeId === undefined) {
      const allEmps = await storage.getAllEmployees();
      const matches = allEmps.filter(e => e.status === "active" && e.name.trim() === (updateData.dispatchName as string).trim());
      updateData.linkedEmployeeId = matches.length === 1 ? matches[0].id : null;
    }
    const updated = await storage.updateDispatchShift(id, updateData);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/dispatch-shifts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteDispatchShift(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/dispatch-shifts/reconcile-links", async (req, res) => {
  try {
    const count = await storage.reconcileDispatchLinks();
    res.json({ updated: count, message: `已自動連結 ${count} 筆派遣班次` });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

}

