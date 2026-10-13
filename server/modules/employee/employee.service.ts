/**
 * Employee service.
 *
 * Owns active-employee filtering, region-scoped lookup with multi-region
 * de-dupe, code-batch lookup for legacy XLSX columns, and the post-write
 * fire-and-forget reconcileDispatchLinks side effect.
 */
import { storage } from "../../storage";
import { insertEmployeeSchema, type Employee, type InsertEmployee } from "@shared/schema";

export const employeeService = {
  async findAllActive(): Promise<Employee[]> {
    const all = await storage.getAllEmployees();
    return all.filter((e) => e.status === "active");
  },

  async findByCodes(codeCsv: string) {
    const codeList = codeCsv.split(",").map((c) => c.trim()).filter(Boolean);
    if (codeList.length === 0) return {};
    const all = await storage.getAllEmployees();
    const result: Record<string, { id: number; name: string; employeeCode: string; status: string }> = {};
    for (const code of codeList) {
      const emp = all.find((e) => e.employeeCode === code);
      if (emp) {
        result[code] = { id: emp.id, name: emp.name, employeeCode: emp.employeeCode, status: emp.status };
      }
    }
    return result;
  },

  async findByRegionCodes(regionCodeCsv: string): Promise<Employee[]> {
    const codes = regionCodeCsv.split(",").map((c) => c.trim()).filter(Boolean);
    const seen = new Set<number>();
    const out: Employee[] = [];
    for (const code of codes) {
      const region = await storage.getRegionByCode(code);
      if (!region) continue;
      const list =
        code === "D"
          ? await storage.getEmployeesForNeiQin(region.id)
          : await storage.getEmployeesByRegion(region.id);
      for (const e of list) {
        if (e.status !== "active") continue;
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
    }
    return out;
  },

  async findForSchedule(regionCodeCsv: string, startDate: string, endDate: string) {
    const active = await this.findByRegionCodes(regionCodeCsv);
    const ids = new Set(active.map(e => e.id));
    for (const code of new Set(regionCodeCsv.split(",").map(c => c.trim()).filter(Boolean))) {
      const region = await storage.getRegionByCode(code);
      if (!region) continue;
      const shifts = [
        ...await storage.getShiftsByRegionAndDateRange(region.id, startDate, endDate),
        ...await storage.getDispatchedShiftsToRegion(region.id, startDate, endDate),
      ];
      for (const shift of shifts) ids.add(shift.employeeId);
    }
    const all = ids.size ? await storage.getAllEmployees() : [];
    const byId = new Map(all.map(e => [e.id, e]));
    return [...ids].flatMap(id => {
      const e = byId.get(id);
      return e ? [{ id: e.id, name: e.name, employeeCode: e.employeeCode,
        role: e.role, employmentType: e.employmentType, regionId: e.regionId, status: e.status }] : [];
    });
  },

  async create(payload: unknown): Promise<Employee> {
    const parsed = insertEmployeeSchema.parse(payload);
    const emp = await storage.createEmployee(parsed);
    storage.reconcileDispatchLinks().catch(() => {});
    return emp;
  },

  async update(id: number, payload: unknown): Promise<Employee | null> {
    const partial = insertEmployeeSchema.partial().parse(payload);
    const emp = await storage.updateEmployee(id, partial as Partial<InsertEmployee>);
    if (!emp) return null;
    storage.reconcileDispatchLinks().catch(() => {});
    return emp;
  },

  remove: (id: number) => storage.deleteEmployee(id),
};
