import { type Express } from "express";
import { type Server } from "http";
import { storage } from "../../storage";

export function mountOvertimeRoutes(httpServer: Server, app: Express): void {
  app.post("/api/portal/overtime-request", async (req, res) => {
  try {
    const { employeeId, date, startTime, endTime, reason, evidenceImageUrl } = req.body;
    if (!employeeId || !date || !startTime || !endTime || !reason) {
      return res.status(400).json({ message: "缺少必要欄位" });
    }
    const emp = await storage.getEmployee(employeeId);
    if (!emp) return res.status(404).json({ message: "找不到員工" });

    const record = await storage.createOvertimeRequest({
      employeeId,
      date,
      startTime,
      endTime,
      reason,
      evidenceImageUrl: evidenceImageUrl || null,
      status: "pending",
      reviewedBy: null,
      reviewedByName: null,
      reviewNote: null,
    });
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/portal/overtime-requests/:employeeId", async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId);
    const records = await storage.getOvertimeRequestsByEmployee(employeeId);
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/overtime-requests", async (req, res) => {
  try {
    const { status } = req.query;
    const records = await storage.getOvertimeRequests(status as string | undefined);

    const employeeIds = [...new Set(records.map(r => r.employeeId))];
    const employeeMap = new Map<number, any>();
    for (const id of employeeIds) {
      const emp = await storage.getEmployee(id);
      if (emp) employeeMap.set(id, emp);
    }

    const clockRecordIds = records.filter(r => r.clockRecordId).map(r => r.clockRecordId!);
    const clockRecordMap = new Map<number, any>();
    for (const crId of clockRecordIds) {
      const cr = await storage.getClockRecord(crId);
      if (cr) clockRecordMap.set(crId, cr);
    }

    const enriched = records.map(r => ({
      ...r,
      employeeName: employeeMap.get(r.employeeId)?.name || "未知",
      employeeCode: employeeMap.get(r.employeeId)?.employeeCode || "",
      linkedClockTime: r.clockRecordId && clockRecordMap.has(r.clockRecordId)
        ? clockRecordMap.get(r.clockRecordId).clockTime
        : null,
    }));

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/overtime-requests/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, reviewNote } = req.body;
    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "status 必須為 approved 或 rejected" });
    }

    const request = await storage.getOvertimeRequest(id);
    if (!request) return res.status(404).json({ message: "找不到加班申請" });
    if (request.status !== "pending") {
      return res.status(400).json({ message: "此申請已審核完畢" });
    }

    const adminId = req.session.adminId || 0;
    const adminName = req.session.adminName || "管理員";
    const updated = await storage.updateOvertimeRequestStatus(id, status, adminId, adminName, reviewNote);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});
}

