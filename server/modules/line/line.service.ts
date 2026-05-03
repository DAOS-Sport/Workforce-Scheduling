/**
 * LINE / LIFF service.
 *
 * Owns the LIFF clock-in orchestration (signature/channel verification still
 * lives in line-webhook.ts and is invoked from the route layer because it
 * needs the raw HTTP request). Push-on-success and the auto-back-fill of an
 * employee's lineId belong here so any future caller can reuse them.
 */
import { storage } from "../../storage";
import {
  processClockIn,
  pushToLine,
  isValidLineUserId,
  formatClockInMessage,
  pushPendingGuidelinesIfAny,
} from "../../line-webhook";

export interface LiffClockInPayload {
  lineUserId?: string;
  employeeId?: number | string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  clockType?: string;
}

export const lineService = {
  async backfillLineIdIfNeeded(lineUserId: string | undefined): Promise<void> {
    if (!lineUserId || !isValidLineUserId(lineUserId)) return;
    const emp = await storage.getEmployeeByLineId(lineUserId);
    if (!emp) return;
    if (emp.lineId && isValidLineUserId(emp.lineId)) return;
    await storage.updateEmployee(emp.id, { lineId: lineUserId });
    console.log(`[LIFF] 自動回寫 LINE ID: ${emp.name}(${emp.employeeCode}) → ${lineUserId}`);
  },

  async processLiffClockIn(payload: LiffClockInPayload) {
    const { lineUserId, employeeId, latitude, longitude, accuracy, clockType } = payload;
    if ((!lineUserId && !employeeId) || latitude === undefined || longitude === undefined) {
      const err: any = new Error("lineUserId or employeeId, latitude, longitude are required");
      err.status = 400;
      throw err;
    }
    console.log(
      `[Clock-in] User: ${lineUserId || `emp#${employeeId}`}, Lat: ${latitude}, Lng: ${longitude}, Accuracy: ${accuracy}m, Type: ${clockType || "auto"}`,
    );
    await this.backfillLineIdIfNeeded(lineUserId);

    const params = employeeId ? { employeeId: Number(employeeId) } : { lineUserId: lineUserId! };
    const forcedType = clockType === "in" || clockType === "out" ? (clockType as "in" | "out") : undefined;
    const result = await processClockIn(params, latitude, longitude, forcedType);

    if (result.status === "success" || result.status === "warning") {
      try {
        let empToNotify = null;
        if (lineUserId && isValidLineUserId(lineUserId)) {
          empToNotify = await storage.getEmployeeByLineId(lineUserId);
        } else if (employeeId) {
          empToNotify = await storage.getEmployee(Number(employeeId));
        }
        if (empToNotify?.lineId && isValidLineUserId(empToNotify.lineId)) {
          const msg = formatClockInMessage(result);
          await pushToLine(empToNotify.lineId, msg);
          if (result.clockType === "in") {
            pushPendingGuidelinesIfAny(empToNotify.id, empToNotify.lineId).catch(() => {});
          }
        }
      } catch (pushErr) {
        console.error("[LIFF] LINE push error:", pushErr);
      }
    }

    return result;
  },
};
