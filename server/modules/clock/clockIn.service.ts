import type { Employee, InsertClockRecord } from "@shared/schema";
import { formatTaipeiTime, taipeiClock } from "../../core/time/taipei";
import {
  DEDUP_WINDOW_MIN,
  classifyTiming,
  clockTypeForShift,
  coveredByApprovedOvertime,
  duplicateClock,
  isAccidentalRepeat,
  isInShiftWindow,
  lateDepartureReason,
  nearbyVenueList,
  nextClockType,
  pickVenue,
  rankVenues,
  successfulNewestFirst,
  type ClockEvent,
  type ClockType,
  type NearbyVenue,
} from "../../core/clock/clockRules";
import { pickLineEmployee } from "../../core/clock/lineEmployee";
import { LOCK_NS, lockXact, withTx, type Tx } from "../../infra/db/tx";
import { noteRequestSubject } from "../../shared/http/requestId";
import { maskId } from "../../shared/log";
import { venueService } from "../venue/venue.service";
import { employeeService } from "../employee/employee.service";
import { shiftService } from "../shift/shift.service";
import { overtimeService } from "../overtime/overtime.service";
import { clockService } from "./clock.service";
import { getCachedVenues } from "./venueCache";
import type { ClockInError, ClockInFail, ClockInOutcome, ClockInResult, ClockInSuccess, ClockInWarning } from "./clockIn.types";

export type { ClockInResult, ClockInOutcome } from "./clockIn.types";

export interface ClockInParams {
  lineUserId?: string;
  employeeId?: number;
}

export interface ClockInOptions {
  forcedClockType?: ClockType;
  accuracy?: number;
  /** When the person clocked in, if the sender knows (a LINE event's timestamp). Defaults to now, read under the lock. */
  at?: Date;
  /** The sender's id for this press of the button. Sending it again returns the first answer and writes nothing. */
  requestId?: string;
}

interface Moment {
  at: Date;
  date: string;
  minutes: number;
  time: string;
}

interface Position {
  lat: number;
  lng: number;
}

interface VenueMatch {
  picked: NonNullable<ReturnType<typeof pickVenue>>;
  nearbyVenues: NearbyVenue[];
}

const momentOf = (at: Date): Moment => {
  const { date, minutes } = taipeiClock(at);
  return { at, date, minutes, time: formatTaipeiTime(at) };
};

function baseOutcome(when: Moment, where: Position, over: Partial<Omit<ClockInFail, "status">> = {}) {
  return {
    clockType: "in" as const,
    venueName: null,
    distance: null,
    time: when.time,
    date: when.date,
    shiftInfo: null,
    failReason: null,
    employeeName: null,
    radius: null,
    nearbyVenues: [],
    userLat: where.lat,
    userLng: where.lng,
    ...over,
  };
}

const errorResult = (when: Moment, where: Position, over: Partial<Omit<ClockInError, "status">>): ClockInError => ({
  status: "error",
  ...baseOutcome(when, where, over),
});
const failResult = (when: Moment, where: Position, over: Partial<Omit<ClockInFail, "status">>): ClockInFail => ({
  status: "fail",
  ...baseOutcome(when, where, over),
});

/** How far a LINE event time may trail or lead the server clock and still be used: enough for a cold start, not enough for a redelivered event to back-date a row. */
const EVENT_TIME_MAX_AGE_MS = 5 * 60_000;
const EVENT_TIME_MAX_AHEAD_MS = 60_000;

function clockTimeFor(eventAt: Date | undefined, now: Date): Date {
  if (!eventAt) return now;
  const age = now.getTime() - eventAt.getTime();
  if (age <= EVENT_TIME_MAX_AGE_MS && age >= -EVENT_TIME_MAX_AHEAD_MS) return eventAt;
  console.warn(`[clock] LINE 事件時間與現在差 ${Math.round(age / 1000)} 秒，改用處理當下的時間`);
  return now;
}

/** The one place a stale `lastSuccess.clockTime` after `at` is accepted as "the same moment": a LINE event time can trail a row another request just committed. */
function decisionTime(at: Date, lastSuccess: ClockEvent | null): number {
  const lastMs = lastSuccess?.clockTime ? new Date(lastSuccess.clockTime).getTime() : null;
  if (lastMs !== null && lastMs > at.getTime() && lastMs - at.getTime() <= DEDUP_WINDOW_MIN * 60000) return lastMs;
  return at.getTime();
}

async function resolveEmployee(params: ClockInParams, venueRegionId: number | null): Promise<Employee | undefined> {
  if (params.employeeId) return employeeService.getEmployee(params.employeeId);
  if (!params.lineUserId) return undefined;
  const picked = pickLineEmployee(await employeeService.getEmployeesByLineId(params.lineUserId), venueRegionId);
  if (picked?.fellBack) {
    console.warn(`[clock] LINE ${maskId(params.lineUserId)} 對到多筆在職員工資料且地區對不上，改用 id 最小的 emp#${picked.employee.id}`);
  }
  return picked?.employee;
}

/** The error for an employee who cannot clock in, or null when they can. */
function unusableEmployee(employee: Employee | undefined, params: ClockInParams, when: Moment, where: Position): ClockInError | null {
  if (!employee) {
    return errorResult(when, where, { failReason: params.lineUserId ? "LINE 帳號尚未綁定員工資料" : "找不到員工資料" });
  }
  if (employee.status !== "active") {
    return errorResult(when, where, { failReason: "帳號目前為非在職狀態", employeeName: employee.name });
  }
  return null;
}

/**
 * Clock one employee in or out. Venues and the employee are looked up first, outside the
 * transaction, so a request waiting on the clock lock holds exactly one pooled connection.
 * Everything that decides and writes runs under that lock, on a fresh clock and fresh rows.
 * LINE replies and pushes belong to the caller, after this returns (the transaction has committed).
 */
export async function processClockIn(
  params: ClockInParams,
  lat: number,
  lng: number,
  options: ClockInOptions = {},
): Promise<ClockInOutcome> {
  const where: Position = { lat, lng };
  const venues = await getCachedVenues(() => venueService.findAll());
  const ranked = rankVenues(lat, lng, venues);
  const picked = pickVenue(ranked);

  const candidate = await resolveEmployee(params, picked?.venue.regionId ?? null);
  const early = unusableEmployee(candidate, params, momentOf(options.at ?? new Date()), where);
  if (early) return { result: early, employeeId: candidate?.id ?? null, replayed: false };

  const employeeId = candidate!.id;
  noteRequestSubject({ employeeId });
  const match: VenueMatch | null = picked && { picked, nearbyVenues: nearbyVenueList(ranked) };

  return withTx(async (tx): Promise<ClockInOutcome> => {
    await lockXact(tx, LOCK_NS.clock, employeeId);
    const when = momentOf(clockTimeFor(options.at, new Date()));

    const employee = await employeeService.getEmployee(employeeId, tx);
    const unusable = unusableEmployee(employee, params, when, where);
    if (unusable) return { result: unusable, employeeId, replayed: false };

    // Claim the request id under the lock: a second copy waits for the first to commit, then finds its answer here.
    const scope = `clock-in:${employeeId}`;
    const { requestId } = options;
    if (requestId && !(await clockService.claimIdempotencyKey(scope, requestId, tx))) {
      const stored = await clockService.getIdempotencyResult(scope, requestId, tx);
      if (stored) return { result: stored as ClockInResult, employeeId, replayed: true };
    }

    const result = await decideAndWrite(tx, employee!, when, where, match, options);
    if (requestId) await clockService.storeIdempotencyResult(scope, requestId, result, tx);
    return { result, employeeId, replayed: false };
  });
}

async function decideAndWrite(
  tx: Tx,
  employee: Employee,
  when: Moment,
  where: Position,
  match: VenueMatch | null,
  options: ClockInOptions,
): Promise<ClockInResult> {
  const { forcedClockType, accuracy } = options;
  const { lat, lng } = where;
  const record = (data: Omit<InsertClockRecord, "employeeId" | "latitude" | "longitude" | "accuracy" | "clockTime">) =>
    clockService.createClockRecord({ ...data, employeeId: employee.id, latitude: lat, longitude: lng, accuracy: accuracy ?? null, clockTime: when.at }, tx);

  const recentRecords = await clockService.getClockRecordsByEmployee(employee.id, when.date, when.date, tx);
  // 今日所有「成功」打卡，依時間新→舊排序；最新一筆用來判斷方向與防呆。
  const successRecords = successfulNewestFirst(recentRecords);
  const lastSuccess = successRecords[0] ?? null;
  const guardMs = decisionTime(when.at, lastSuccess);

  // 重複打卡：距上次成功打卡不足 5 分鐘、同方向就擋下，並留一筆失敗紀錄給管理者看。
  // 只有指定方向（強制上班或下班）才會同方向；自動判斷方向一定換方向，不會被這裡擋。
  const duplicate = duplicateClock(lastSuccess, guardMs, forcedClockType);
  if (duplicate && lastSuccess) {
    try {
      // 稽核紀錄寫不進去不能拖垮打卡：放在 savepoint 裡，失敗只回滾這一筆。
      await tx.transaction((savepoint) =>
        clockService.createClockRecord(
          {
            employeeId: employee.id,
            venueId: lastSuccess.venueId ?? null,
            shiftId: null,
            clockType: duplicate.clockType,
            latitude: lat,
            longitude: lng,
            accuracy: accuracy ?? null,
            distance: null,
            status: "fail",
            failReason: duplicate.failReason,
            matchedVenueName: lastSuccess.matchedVenueName || null,
            clockTime: when.at,
          },
          savepoint,
        ),
      );
    } catch (err) {
      console.error("[clock] failed to write dedup audit record", err);
    }
    return failResult(when, where, {
      clockType: duplicate.clockType as ClockType,
      venueName: lastSuccess.matchedVenueName || null,
      failReason: duplicate.failReason,
      employeeName: employee.name,
    });
  }

  // 防呆翻轉守門：剛「上班打卡」成功後極短時間內又被點一次時，自動方向判斷會把它
  // 翻成「下班」、偷偷記一筆早退。這裡擋下 → 視為同一次上班、不重複建檔、也不翻面。
  // 注意：只擋「上班後的快速重點」；下班打卡不受限，確保下班後可以無限補打卡。
  if (lastSuccess && isAccidentalRepeat(lastSuccess, guardMs, forcedClockType)) {
    return {
      status: "success",
      ...baseOutcome(when, where, {
        venueName: lastSuccess.matchedVenueName ?? null,
        time: formatTaipeiTime(new Date(lastSuccess.clockTime!)),
        failReason: "您剛才已完成上班打卡，無需重複",
        employeeName: employee.name,
      }),
      recordId: lastSuccess.id,
    } satisfies ClockInSuccess;
  }

  if (!match) {
    return failResult(when, where, { failReason: "系統中沒有設定場館座標", employeeName: employee.name });
  }
  const { picked, nearbyVenues } = match;
  const closestVenue = picked.venue;
  const closestDistance = Math.round(picked.distance);
  const effectiveRadius = picked.radius;

  if (!picked.inRange) {
    const failClockType = forcedClockType || nextClockType(recentRecords);
    await record({
      venueId: null,
      shiftId: null,
      clockType: failClockType,
      distance: closestDistance,
      status: "fail",
      failReason: "不在任何場館範圍內",
      matchedVenueName: closestVenue.shortName,
    });
    return failResult(when, where, {
      clockType: failClockType,
      venueName: closestVenue.shortName,
      distance: closestDistance,
      failReason: "不在任何場館範圍內",
      employeeName: employee.name,
      radius: effectiveRadius,
      nearbyVenues,
    });
  }

  const todayShifts = await shiftService.getShiftsByEmployeeAndDateRange(employee.id, when.date, when.date, tx);
  const venueShifts = todayShifts.filter((s) => s.venueId === closestVenue.id);
  const matchingShift = venueShifts.find((s) => isInShiftWindow(when.minutes, s));

  if (venueShifts.length === 0) {
    const warnClockType = forcedClockType || nextClockType(recentRecords);
    await record({
      venueId: closestVenue.id,
      shiftId: null,
      clockType: warnClockType,
      distance: closestDistance,
      status: "warning",
      failReason: "今日無排班",
      matchedVenueName: closestVenue.shortName,
    });
    return {
      status: "warning",
      ...baseOutcome(when, where, {
        clockType: warnClockType,
        venueName: closestVenue.shortName,
        distance: closestDistance,
        failReason: "今日無排班",
        employeeName: employee.name,
        radius: effectiveRadius,
        nearbyVenues,
      }),
    } satisfies ClockInWarning;
  }

  const shiftInfo = matchingShift || venueShifts[0];
  // 方向判斷（下班後可無限打卡的核心）：同一班別只要已有「上班」成功紀錄，
  // 之後在該班別的每一次打卡都算「下班」，不會再翻回上班 → 下班可重複、無限打。
  const clockType = clockTypeForShift(successRecords, shiftInfo.id, forcedClockType);

  let lateReason: string | null = null;
  let earlyArrival = false;
  let earlyMinutes = 0;
  let lateDeparture = false;
  let lateMinutes = 0;

  const timing = classifyTiming(clockType, when.minutes, shiftInfo);
  if (timing.kind === "late" || timing.kind === "early_leave") {
    lateReason = timing.reason;
  } else if (timing.kind === "early_arrival") {
    earlyArrival = true;
    earlyMinutes = timing.minutes;
    lateReason = timing.reason;
  } else if (timing.kind === "after_shift") {
    const approvedOT = await overtimeService.getOvertimeRequestsByEmployeeAndDate(employee.id, when.date, tx);
    if (coveredByApprovedOvertime(when.minutes, approvedOT)) {
      lateReason = "加班打卡";
    } else {
      lateDeparture = true;
      lateMinutes = timing.minutes;
      lateReason = lateDepartureReason(timing.minutes);
    }
  }

  const clockRecord = await record({
    venueId: closestVenue.id,
    shiftId: matchingShift?.id || venueShifts[0].id,
    clockType,
    distance: closestDistance,
    status: "success",
    failReason: lateReason,
    matchedVenueName: closestVenue.shortName,
  });

  return {
    status: "success",
    ...baseOutcome(when, where, {
      clockType,
      venueName: closestVenue.shortName,
      distance: closestDistance,
      shiftInfo: `${shiftInfo.startTime.slice(0, 5)}-${shiftInfo.endTime.slice(0, 5)}`,
      failReason: lateReason,
      employeeName: employee.name,
      radius: effectiveRadius,
      nearbyVenues,
    }),
    recordId: clockRecord.id,
    earlyArrival,
    earlyMinutes,
    lateDeparture,
    lateMinutes,
  } satisfies ClockInSuccess;
}
