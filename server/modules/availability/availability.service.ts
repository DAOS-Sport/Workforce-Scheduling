import { httpError } from "../../shared/http/response";
import { availabilityRepository } from "./availability.repository";
import { regionService } from "../region/region.service";
import { employeeService } from "../employee/employee.service";

export async function listAvailabilities(regionCode: string | undefined, yearMonth: string | undefined) {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw httpError(400, "yearMonth 為必填，格式為 YYYY-MM");
  }
  let employeeIds: number[];
  if (regionCode) {
    const region = await regionService.findByCode(regionCode);
    if (!region) return [];
    const emps = await employeeService.getEmployeesByRegion(region.id);
    employeeIds = emps.filter(e => e.status !== "inactive").map(e => e.id);
  } else {
    const emps = await employeeService.getAllEmployees();
    employeeIds = emps.filter(e => e.status !== "inactive").map(e => e.id);
  }
  return availabilityRepository.getByEmployeeIds(employeeIds, yearMonth);
}

export const availabilityService = {
  countOffRequestsByNoteAndYear: availabilityRepository.countOffRequestsByNoteAndYear,
  create: availabilityRepository.create,
  delete: availabilityRepository.delete,
  existsOnDate: availabilityRepository.existsOnDate,
  getByEmployeeAndYearMonth: availabilityRepository.getByEmployeeAndYearMonth,
  getById: availabilityRepository.getById,
  getByYearMonth: availabilityRepository.getByYearMonth,
};
