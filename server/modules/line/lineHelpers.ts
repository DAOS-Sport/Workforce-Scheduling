export function getTaiwanNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

export function formatTaiwanTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function formatTaiwanDate(date: Date): string {
  const y = date.getFullYear();
  const mo = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export const LEAVE_TYPES = ["休假", "特休", "病假", "事假", "喪假", "公假", "生理假", "國定假"];
