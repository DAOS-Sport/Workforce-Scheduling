/**
 * Attendance service — read/delete on the rows produced by XLSX import.
 * The import handler itself lives in modules/importExport because it
 * spans more than one persistence concern.
 */
import { storage } from "../../storage";

export const attendanceService = {
  listUploads: () => storage.getAttendanceUploads(),

  recordsByUpload: (uploadId: number) => storage.getAttendanceRecordsByUpload(uploadId),

  recordsByDateRange: (startDate: string, endDate: string, codes?: string[]) =>
    storage.getAttendanceRecordsByDateRange(startDate, endDate, codes),

  async deleteUpload(id: number): Promise<boolean> {
    await storage.deleteAttendanceRecordsByUpload(id);
    return storage.deleteAttendanceUpload(id);
  },
};
