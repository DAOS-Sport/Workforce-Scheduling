import { type Express } from "express";
import { type Server } from "http";
import { employeeService } from "./employee.service";

export function mountEmployeeRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/employees/schedule/:regionCode/:startDate/:endDate", async (req, res) => {
    const { regionCode, startDate, endDate } = req.params;
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      return res.status(400).json({ message: "日期區間格式錯誤" });
    }
    try {
      res.json(await employeeService.findForSchedule(regionCode, startDate, endDate));
    } catch {
      res.status(500).json({ message: "無法讀取歷史班表人員" });
    }
  });

  app.get("/api/employees-all", async (_req, res) => {
    res.json(await employeeService.findAllActive());
  });

  app.get("/api/employees", async (req, res) => {
    try {
      const { codes } = req.query;
      if (!codes) return res.status(400).json({ message: "codes 查詢參數為必填" });
      res.json(await employeeService.findByCodes(String(codes)));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Employee management page: resigned employees stay listed (shown as 離職).
  app.get("/api/employees/manage/:regionCode", async (req, res) => {
    res.json(await employeeService.findByRegionCodes(req.params.regionCode, { includeInactive: true }));
  });

  app.get("/api/employees/:regionCode", async (req, res) => {
    res.json(await employeeService.findByRegionCodes(req.params.regionCode));
  });

  app.post("/api/employees", async (req, res) => {
    try {
      const employee = await employeeService.create(req.body);
      res.json(employee);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤：" + err.errors.map((e: any) => e.message).join(", ") });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/employees/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const employee = await employeeService.update(id, req.body);
      if (!employee) return res.status(404).json({ message: "Employee not found" });
      res.json(employee);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "資料格式錯誤" });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/employees/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await employeeService.remove(id);
      if (!deleted) return res.status(404).json({ message: "Employee not found" });
      res.json({ message: "Employee deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
