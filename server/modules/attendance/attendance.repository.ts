import { storage } from "../../storage";

export const attendanceRepository = {
  // Uploads
  getUploads: storage.getAttendanceUploads.bind(storage),
  createUpload: storage.createAttendanceUpload.bind(storage),
  updateUpload: storage.updateAttendanceUpload.bind(storage),
  deleteUpload: storage.deleteAttendanceUpload.bind(storage),

  // Records
  createRecords: storage.createAttendanceRecords.bind(storage),
  getRecordsByUpload: storage.getAttendanceRecordsByUpload.bind(storage),
  getRecordsByDateRange: storage.getAttendanceRecordsByDateRange.bind(storage),
  deleteRecordsByUpload: storage.deleteAttendanceRecordsByUpload.bind(storage),
};
