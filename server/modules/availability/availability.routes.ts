/**
 * Admin availability routes — view all employee availabilities.
 * Endpoints:
 *   GET  /api/availabilities?regionCode=A&yearMonth=2026-06
 */
import { type Express } from "express";
import { type Server } from "http";
import { availabilityRepository } from "./availability.repository";
import { storage } from "../../storage";
import { ok, fail, badRequest } from "../../shared/http/response";

export function mountAvailabilityRoutes(_httpServer: Server, app: Express): void {
  app.get("/api/availabilities", async (req, res) => {
    try {
      const { regionCode, yearMonth } = req.query as Record<string, string>;
      if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
        return badRequest(res, "yearMonth 為必填，格式為 YYYY-MM");
      }
      let employeeIds: number[];
      if (regionCode) {
        const region = await storage.getRegionByCode(regionCode);
        if (!region) return ok(res, []);
        const emps = await storage.getEmployeesByRegion(region.id);
        employeeIds = emps.filter(e => e.status !== "inactive").map(e => e.id);
      } else {
        const emps = await storage.getAllEmployees();
        employeeIds = emps.filter(e => e.status !== "inactive").map(e => e.id);
      }
      ok(res, await availabilityRepository.getByEmployeeIds(employeeIds, yearMonth));
    } catch (err: any) {
      fail(res, 500, err.message);
    }
  });
}
