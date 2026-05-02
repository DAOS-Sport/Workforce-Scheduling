/**
 * Employee repository — thin wrapper around storage for the employee
 * domain. Lets future refactors move logic out of storage.ts without
 * forcing every employee route to change its imports.
 */
import { storage } from "../../storage";

export const employeeRepository = {
  getAll: storage.getAllEmployees.bind(storage),
  getById: storage.getEmployee.bind(storage),
  getByCode: storage.getEmployeeByCode.bind(storage),
  getByLineId: storage.getEmployeeByLineId.bind(storage),
  getByRegion: storage.getEmployeesByRegion.bind(storage),
  getForNeiQin: storage.getEmployeesForNeiQin.bind(storage),
  create: storage.createEmployee.bind(storage),
  update: storage.updateEmployee.bind(storage),
  delete: storage.deleteEmployee.bind(storage),
};
