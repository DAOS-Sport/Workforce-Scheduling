import { storage } from "../../storage";

export const leaveRepository = {
  create: storage.createLeaveRequest.bind(storage),
  getAll: storage.getLeaveRequests.bind(storage),
  getByEmployee: storage.getLeaveRequestsByEmployee.bind(storage),
  getById: storage.getLeaveRequest.bind(storage),
  updateStatus: storage.updateLeaveRequestStatus.bind(storage),
};
