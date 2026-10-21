/**
 * 台北時間的純函式工具。台北固定 UTC+8、沒有日光節約時間，所以不依賴伺服器時區設定。
 */
const OFFSET_MS = 8 * 60 * 60 * 1000;

export interface TaipeiClock {
  /** YYYY-MM-DD */
  date: string;
  /** 當天第幾分鐘（0–1439） */
  minutes: number;
  /** 0＝週日 … 6＝週六 */
  weekday: number;
}

export function taipeiClock(instant: Date): TaipeiClock {
  const t = new Date(instant.getTime() + OFFSET_MS);
  return {
    date: t.toISOString().slice(0, 10),
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
    weekday: t.getUTCDay(),
  };
}

/** 台北某天的第幾分鐘，對應到的絕對時間。 */
export function taipeiInstant(date: string, minutes: number): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - OFFSET_MS);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `HH:MM`（台北） */
export function formatTaipeiTime(instant: Date): string {
  const { minutes } = taipeiClock(instant);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** `MM/DD HH:MM`（台北） */
export function formatTaipeiDateTime(instant: Date): string {
  const { date } = taipeiClock(instant);
  return `${date.slice(5, 7)}/${date.slice(8, 10)} ${formatTaipeiTime(instant)}`;
}
