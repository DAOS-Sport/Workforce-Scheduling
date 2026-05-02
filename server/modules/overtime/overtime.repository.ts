import { storage } from "../../storage";

export const overtimeRepository = {
  create: storage.createOvertimeRequest.bind(storage),
  getAll: storage.getOvertimeRequests.bind(storage),
  getByEmployee: storage.getOvertimeRequestsByEmployee.bind(storage),
  getById: storage.getOvertimeRequest.bind(storage),
  updateStatus: storage.updateOvertimeRequestStatus.bind(storage),
  getByEmployeeAndDate: storage.getOvertimeRequestsByEmployeeAndDate.bind(storage),
  getApprovedByDateRange: storage.getApprovedOvertimeByDateRange.bind(storage),
};
