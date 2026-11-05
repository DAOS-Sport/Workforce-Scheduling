/**
 * Attendance service — read/delete on the rows produced by XLSX import.
 * The import handler itself lives in modules/importExport because it
 * spans more than one persistence concern.
 */
import { withTx } from "../../infra/db/tx";
import { attendanceRepository } from "./attendance.repository";

export const attendanceService = {
  listUploads: () => attendanceRepository.getAttendanceUploads(),

  recordsByUpload: (uploadId: number) => attendanceRepository.getAttendanceRecordsByUpload(uploadId),

  recordsByDateRange: (startDate: string, endDate: string, codes?: string[]) =>
    attendanceRepository.getAttendanceRecordsByDateRange(startDate, endDate, codes),

  /** Remove an upload and its records together; if either delete fails, both stay. */
  async deleteUpload(id: number): Promise<boolean> {
    return withTx(async (tx) => {
      await attendanceRepository.deleteAttendanceRecordsByUpload(id, tx);
      return attendanceRepository.deleteAttendanceUpload(id, tx);
    });
  },

  createAttendanceRecords: attendanceRepository.createAttendanceRecords,
  createAttendanceUpload: attendanceRepository.createAttendanceUpload,
  getAttendanceUpload: attendanceRepository.getAttendanceUpload,
  getAttendanceRecordsByDateRange: attendanceRepository.getAttendanceRecordsByDateRange,
  updateAttendanceUpload: attendanceRepository.updateAttendanceUpload,
};
