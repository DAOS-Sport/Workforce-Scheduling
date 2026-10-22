/**
 * Attendance service — read/delete on the rows produced by XLSX import.
 * The import handler itself lives in modules/importExport because it
 * spans more than one persistence concern.
 */
import { attendanceRepository } from "./attendance.repository";

export const attendanceService = {
  listUploads: () => attendanceRepository.getAttendanceUploads(),

  recordsByUpload: (uploadId: number) => attendanceRepository.getAttendanceRecordsByUpload(uploadId),

  recordsByDateRange: (startDate: string, endDate: string, codes?: string[]) =>
    attendanceRepository.getAttendanceRecordsByDateRange(startDate, endDate, codes),

  async deleteUpload(id: number): Promise<boolean> {
    await attendanceRepository.deleteAttendanceRecordsByUpload(id);
    return attendanceRepository.deleteAttendanceUpload(id);
  },

  createAttendanceRecords: attendanceRepository.createAttendanceRecords,
  createAttendanceUpload: attendanceRepository.createAttendanceUpload,
  getAttendanceRecordsByDateRange: attendanceRepository.getAttendanceRecordsByDateRange,
  updateAttendanceUpload: attendanceRepository.updateAttendanceUpload,
};
