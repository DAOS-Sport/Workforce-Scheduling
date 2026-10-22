/**
 * LIFF service (Task #73 重構 D — extracted from modules/line/line.service.ts).
 *
 * Owns the LIFF clock-in orchestration: GPS-based clock-in handling and the
 * post-clock-in LINE push (with pending-guideline reminder fan-out).
 *
 * The low-level signature/channel verification still lives under
 * modules/line/ and is invoked from the LINE webhook route layer because
 * it needs the raw HTTP request — LIFF requests don't carry a LINE
 * signature, they're authenticated by lineUserId / employeeId in the body.
 */
import { maskId } from "../../shared/log";
import { processClockIn, formatClockInMessage } from "../line/lineClock.service";
import { pushToLine, pushPendingGuidelinesIfAny } from "../line/linePush.service";
import { isValidLineUserId } from "../line/lineSignature";
import { shiftReviewService } from "../shift/shiftReview.service";
import { employeeService } from "../employee/employee.service";

export interface LiffClockInPayload {
  lineUserId?: string;
  employeeId?: number | string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  clockType?: string;
}

export const liffService = {
  async processLiffClockIn(payload: LiffClockInPayload) {
    const { lineUserId, employeeId, latitude, longitude, accuracy, clockType } = payload;
    if ((!lineUserId && !employeeId) || latitude === undefined || longitude === undefined) {
      const err: any = new Error("lineUserId or employeeId, latitude, longitude are required");
      err.status = 400;
      throw err;
    }
    console.log(
      `[Clock-in] User: ${employeeId ? `emp#${employeeId}` : `line ${maskId(lineUserId)}`}, Accuracy: ${accuracy}m, Type: ${clockType || "auto"}`,
    );

    const params = employeeId ? { employeeId: Number(employeeId) } : { lineUserId: lineUserId! };
    const forcedType = clockType === "in" || clockType === "out" ? (clockType as "in" | "out") : undefined;
    const result = await processClockIn(params, latitude, longitude, forcedType, accuracy);

    if (result.status === "success") {
      try {
        let empToNotify = null;
        if (lineUserId && isValidLineUserId(lineUserId)) {
          empToNotify = await employeeService.getEmployeeByLineId(lineUserId);
        } else if (employeeId) {
          empToNotify = await employeeService.getEmployee(Number(employeeId));
        }
        if (empToNotify?.lineId && isValidLineUserId(empToNotify.lineId)) {
          const reviewedShift = await shiftReviewService.reviewClockRecordShiftForPush(result.recordId);
          if (!reviewedShift) {
            console.log(`[LIFF] 跳過打卡推播（推播前班表審查無有效班）: employeeId=${empToNotify.id} recordId=${result.recordId ?? "none"}`);
            return result;
          }
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
