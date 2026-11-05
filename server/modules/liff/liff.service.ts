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
import { processClockIn } from "../clock/clockIn.service";
import { formatClockInMessage } from "../clock/clockInMessage";
import { pushToLine, pushPendingGuidelinesIfAny } from "../line/linePush.service";
import { isValidLineUserId } from "../line/lineSignature";
import { shiftReviewService } from "../shift/shiftReview.service";
import { employeeService } from "../employee/employee.service";
import { httpError } from "../../shared/errors";

export interface LiffClockInPayload {
  lineUserId?: string;
  employeeId?: number | string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  clockType?: string;
  /** One id per press of the clock-in button; the page sends the same id again when it retries. */
  requestId?: string;
}

export const liffService = {
  async processLiffClockIn(payload: LiffClockInPayload) {
    const { lineUserId, employeeId, latitude, longitude, accuracy, clockType } = payload;
    if ((!lineUserId && !employeeId) || latitude === undefined || longitude === undefined) {
      throw httpError(400, "lineUserId or employeeId, latitude, longitude are required");
    }
    console.log(
      `[Clock-in] User: ${employeeId ? `emp#${employeeId}` : `line ${maskId(lineUserId)}`}, Accuracy: ${accuracy}m, Type: ${clockType || "auto"}`,
    );

    const params = employeeId ? { employeeId: Number(employeeId) } : { lineUserId: lineUserId! };
    const forcedClockType = clockType === "in" || clockType === "out" ? (clockType as "in" | "out") : undefined;
    const requestId = typeof payload.requestId === "string" && payload.requestId.length > 0 && payload.requestId.length <= 128 ? payload.requestId : undefined;
    if (!requestId) console.log("[Clock-in] 請求沒帶 requestId（舊版頁面），這次不做重送去重");
    const { result, employeeId: clockedEmployeeId, replayed } = await processClockIn(params, latitude, longitude, { forcedClockType, accuracy, requestId });

    // The clock-in has committed. Pushing to LINE is a courtesy and never changes the answer.
    if (result.status === "success" && clockedEmployeeId !== null && !replayed) {
      try {
        const empToNotify = await employeeService.getEmployee(clockedEmployeeId);
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
