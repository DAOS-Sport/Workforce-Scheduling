import type { NearbyVenue } from "../../core/clock/clockRules";

export type { NearbyVenue };

interface ClockInOutcomeBase {
  clockType: "in" | "out";
  venueName: string | null;
  distance: number | null;
  time: string;
  date: string;
  shiftInfo: string | null;
  failReason: string | null;
  employeeName: string | null;
  radius: number | null;
  nearbyVenues: NearbyVenue[];
  userLat: number;
  userLng: number;
}

/** No clock row was written: unknown or inactive employee. */
export type ClockInError = ClockInOutcomeBase & { status: "error" };
/** A failure row was written (out of range, repeat) or nothing could be matched (no venue configured). */
export type ClockInFail = ClockInOutcomeBase & { status: "fail" };
/** In range but no shift today; a warning row was written. */
export type ClockInWarning = ClockInOutcomeBase & { status: "warning" };
export type ClockInSuccess = ClockInOutcomeBase & {
  status: "success";
  recordId: number;
  earlyArrival?: boolean;
  earlyMinutes?: number;
  lateDeparture?: boolean;
  lateMinutes?: number;
};

export type ClockInResult = ClockInError | ClockInFail | ClockInWarning | ClockInSuccess;

export interface ClockInOutcome {
  result: ClockInResult;
  /** The employee the clock-in was decided for; null when none could be resolved. */
  employeeId: number | null;
  /** True when this request id was answered before and the stored answer is returned. Nothing was written. */
  replayed: boolean;
}
