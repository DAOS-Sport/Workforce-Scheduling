import { storage } from "../../storage";
import { httpError } from "../../shared/http/response";
import { availabilityRepository } from "./availability.repository";

export async function listAvailabilities(regionCode: string | undefined, yearMonth: string | undefined) {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw httpError(400, "yearMonth 為必填，格式為 YYYY-MM");
  }
  let employeeIds: number[];
  if (regionCode) {
    const region = await storage.getRegionByCode(regionCode);
    if (!region) return [];
    const emps = await storage.getEmployeesByRegion(region.id);
    employeeIds = emps.filter(e => e.status !== "inactive").map(e => e.id);
  } else {
    const emps = await storage.getAllEmployees();
    employeeIds = emps.filter(e => e.status !== "inactive").map(e => e.id);
  }
  return availabilityRepository.getByEmployeeIds(employeeIds, yearMonth);
}
