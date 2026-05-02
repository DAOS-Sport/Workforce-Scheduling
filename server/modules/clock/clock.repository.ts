import { storage } from "../../storage";

export const clockRepository = {
  // Clock records
  create: storage.createClockRecord.bind(storage),
  getById: storage.getClockRecord.bind(storage),
  getByDateRange: storage.getClockRecordsByDateRange.bind(storage),
  getByEmployee: storage.getClockRecordsByEmployee.bind(storage),
  updateReason: storage.updateClockRecordReason.bind(storage),
  applyAmendment: storage.applyClockRecordAmendment.bind(storage),

  // Clock amendments
  createAmendment: storage.createClockAmendment.bind(storage),
  getAmendments: storage.getClockAmendments.bind(storage),
  getAmendmentsByEmployee: storage.getClockAmendmentsByEmployee.bind(storage),
  getAmendment: storage.getClockAmendment.bind(storage),
  updateAmendmentStatus: storage.updateClockAmendmentStatus.bind(storage),

  // Missing clock-in notification dedup
  hasMissingNotification: storage.hasMissingClockNotification.bind(storage),
  createMissingNotification: storage.createMissingClockNotification.bind(storage),
  clearOldMissingNotifications: storage.clearOldMissingClockNotifications.bind(storage),
  getMissingNotificationsForDate: storage.getMissingClockNotificationsForDate.bind(storage),
};
