/**
 * 一個 LINE 帳號對到多筆員工資料時，打卡該記在哪一筆（決策 D1）。
 * 正式庫的實況是同一個人有「舊的停用＋新的在職」，或兩筆在職但地區不同。不碰資料庫。
 */

export interface LineEmployee {
  id: number;
  regionId: number;
  status: string;
}

export interface LineEmployeePick<E extends LineEmployee> {
  employee: E;
  /** 在職多筆、地區又對不上，退而選 id 最小的那筆；呼叫端要記 log。 */
  fellBack: boolean;
}

/**
 * 在職的優先；在職多筆時選與打卡場館同地區的，沒有同地區的就選 id 最小的在職紀錄。
 * 全部停用時回 id 最小的那筆，讓呼叫端回報「非在職」。
 */
export function pickLineEmployee<E extends LineEmployee>(candidates: E[], venueRegionId: number | null): LineEmployeePick<E> | null {
  const byId = [...candidates].sort((a, b) => a.id - b.id);
  if (byId.length === 0) return null;
  const active = byId.filter((e) => e.status === "active");
  if (active.length === 0) return { employee: byId[0], fellBack: false };
  if (active.length === 1) return { employee: active[0], fellBack: false };
  const sameRegion = venueRegionId === null ? undefined : active.find((e) => e.regionId === venueRegionId);
  return sameRegion ? { employee: sameRegion, fellBack: false } : { employee: active[0], fellBack: true };
}
