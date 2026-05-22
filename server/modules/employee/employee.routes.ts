import { type Express } from "express";
import { type Server } from "http";
import { employeeService } from "./employee.service";

export function mountEmployeeRoutes(_httpServer: Server, app: Express): void {
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
      res.status(err.status || 500).json({ message: err.message });
    }
  });
}
