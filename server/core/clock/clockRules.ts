/**
 * 打卡判斷的純規則（從 modules/line/lineClock.service.ts 抽出，行為不變）。
 * 不碰資料庫與網路；時間一律傳「當天第幾分鐘」或毫秒，避免依賴伺服器時區。
 */

export const DEDUP_WINDOW_MIN = 5;
export const FLIP_GUARD_MIN = 2;
export const ATTENDANCE_GRACE_MINUTES = 10;
export const EARLY_OR_LATE_THRESHOLD_MIN = 15;
export const DEFAULT_VENUE_RADIUS_M = 300;

export type ClockType = "in" | "out";

export interface VenuePoint {
  id: number;
  name: string;
  shortName: string;
  latitude: number | null;
  longitude: number | null;
  radius: number | null;
}

export interface RankedVenue<V extends VenuePoint = VenuePoint> {
  venue: V;
  distance: number;
}

export interface NearbyVenue {
  id: number;
  name: string;
  shortName: string;
  distance: number;
  radius: number;
  inRange: boolean;
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const venueRadius = (v: VenuePoint): number => v.radius || DEFAULT_VENUE_RADIUS_M;

/** 有座標的場館依距離由近到遠排序。 */
export function rankVenues<V extends VenuePoint>(lat: number, lng: number, venues: V[]): RankedVenue<V>[] {
  return venues
    .filter((v) => v.latitude && v.longitude)
    .map((venue) => ({ venue, distance: haversineDistance(lat, lng, venue.latitude!, venue.longitude!) }))
    .sort((a, b) => a.distance - b.distance);
}

export function nearbyVenueList(ranked: RankedVenue[], limit = 5): NearbyVenue[] {
  return ranked.slice(0, limit).map(({ venue, distance }) => ({
    id: venue.id,
    name: venue.name,
    shortName: venue.shortName,
    distance: Math.round(distance),
    radius: venueRadius(venue),
    inRange: distance <= venueRadius(venue),
  }));
}

const validRadius = (r: number) => Number.isFinite(r) && r > 0;

/**
 * 選場館（GitHub #3）：每家用自己的半徑判斷，在範圍內的場館裡選最近的；距離剛好等於半徑算在範圍內，
 * 距離相同時 id 小的優先。半徑不是正數的場館不參與。
 * 一家都不在範圍內時，回傳最近的那家並標成不在範圍內（失敗紀錄會寫它的名稱）。
 */
export function pickVenue<V extends VenuePoint>(ranked: RankedVenue<V>[]): { venue: V; distance: number; radius: number; inRange: boolean } | null {
  const usable = ranked.filter((r) => validRadius(venueRadius(r.venue)));
  if (usable.length === 0) return null;
  const legal = usable
    .filter((r) => r.distance <= venueRadius(r.venue))
    .sort((a, b) => a.distance - b.distance || a.venue.id - b.venue.id);
  const chosen = legal[0] ?? usable[0];
  const radius = venueRadius(chosen.venue);
  return { venue: chosen.venue, distance: chosen.distance, radius, inRange: chosen.distance <= radius };
}

export interface ClockEvent {
  clockType: string;
  clockTime: Date | string | null;
  status: string;
  shiftId?: number | null;
}

/** 今天成功的打卡，新到舊。 */
export function successfulNewestFirst<T extends ClockEvent>(records: T[]): T[] {
  return records
    .filter((r) => r.status === "success")
    .sort((a, b) => new Date(b.clockTime ?? 0).getTime() - new Date(a.clockTime ?? 0).getTime());
}

/** 沒有對到班時的打卡方向：看最近一次成功打卡，上班後就是下班。 */
export function nextClockType(records: ClockEvent[]): ClockType {
  const latest = successfulNewestFirst(records)[0];
  if (!latest) return "in";
  return latest.clockType === "in" ? "out" : "in";
}

/**
 * 重複打卡：距上次成功打卡不足 5 分鐘、而且是同一個方向就擋下。換方向一律放行。
 * 回傳 null 表示不擋。
 */
export function duplicateClock(lastSuccess: ClockEvent | null, nowMs: number, forced?: ClockType): { clockType: string; failReason: string } | null {
  if (!lastSuccess?.clockTime) return null;
  const diffMinutes = (nowMs - new Date(lastSuccess.clockTime).getTime()) / 60000;
  if (diffMinutes >= DEDUP_WINDOW_MIN) return null;
  const expectedNext: ClockType = lastSuccess.clockType === "in" ? "out" : "in";
  const intended = forced ?? expectedNext;
  if (intended !== lastSuccess.clockType) return null;
  const remaining = Math.ceil(DEDUP_WINDOW_MIN - diffMinutes);
  const lastType = lastSuccess.clockType === "in" ? "上班" : "下班";
  return {
    clockType: forced || lastSuccess.clockType,
    failReason: `重複打卡：距上次${lastType}打卡不足 ${DEDUP_WINDOW_MIN} 分鐘（還需等待 ${remaining} 分鐘）`,
  };
}

/** 防誤翻：上班打卡成功後 2 分鐘內又點一次（沒有指定方向），視為同一次上班。 */
export function isAccidentalRepeat(lastSuccess: ClockEvent | null, nowMs: number, forced?: ClockType): boolean {
  if (forced || lastSuccess?.clockType !== "in" || !lastSuccess.clockTime) return false;
  const minutes = (nowMs - new Date(lastSuccess.clockTime).getTime()) / 60000;
  return minutes >= 0 && minutes < FLIP_GUARD_MIN;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** 現在是否落在班別時間（前後各加 bufferMinutes）。 */
export function isInShiftWindow(nowMinutes: number, shift: { startTime: string; endTime: string }, bufferMinutes = 30): boolean {
  return nowMinutes >= toMinutes(shift.startTime) - bufferMinutes && nowMinutes <= toMinutes(shift.endTime) + bufferMinutes;
}

/** 對到班時的方向：同一班已有上班成功紀錄，之後都算下班（下班可以無限補打）。 */
export function clockTypeForShift(successRecords: ClockEvent[], shiftId: number, forced?: ClockType): ClockType {
  if (forced) return forced;
  return successRecords.some((r) => r.shiftId === shiftId && r.clockType === "in") ? "out" : "in";
}

const span = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours} 小時 ${mins} 分鐘` : `${mins} 分鐘`;
};

export type Timing =
  | { kind: "on_time" }
  | { kind: "late"; reason: string }
  | { kind: "early_arrival"; minutes: number; reason: string }
  | { kind: "early_leave"; reason: string }
  /** 比下班晚 15 分鐘以上：要再查有沒有核准的加班，才知道是「加班打卡」還是「晚下班」。 */
  | { kind: "after_shift"; minutes: number };

export function classifyTiming(clockType: ClockType, nowMinutes: number, shift: { startTime: string; endTime: string }): Timing {
  if (clockType === "in") {
    const diff = nowMinutes - toMinutes(shift.startTime);
    if (diff > ATTENDANCE_GRACE_MINUTES) return { kind: "late", reason: `遲到 ${span(diff)}` };
    if (diff <= -EARLY_OR_LATE_THRESHOLD_MIN) {
      const minutes = Math.abs(diff);
      return { kind: "early_arrival", minutes, reason: `提早 ${span(minutes)}到` };
    }
    return { kind: "on_time" };
  }
  const diff = toMinutes(shift.endTime) - nowMinutes;
  if (diff > ATTENDANCE_GRACE_MINUTES) return { kind: "early_leave", reason: `早退 ${span(diff)}` };
  if (diff <= -EARLY_OR_LATE_THRESHOLD_MIN) return { kind: "after_shift", minutes: Math.abs(diff) };
  return { kind: "on_time" };
}

/** 晚下班時，現在是否落在某一筆核准加班的時段內（結束後 15 分鐘內也算）。 */
export function coveredByApprovedOvertime(nowMinutes: number, overtime: { status: string; startTime: string; endTime: string }[]): boolean {
  return overtime.some((ot) => ot.status === "approved" && nowMinutes >= toMinutes(ot.startTime) && nowMinutes <= toMinutes(ot.endTime) + EARLY_OR_LATE_THRESHOLD_MIN);
}

export function lateDepartureReason(minutes: number): string {
  return `晚下班 ${span(minutes)}`;
}
