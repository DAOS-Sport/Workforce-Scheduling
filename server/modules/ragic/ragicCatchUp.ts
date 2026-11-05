/**
 * 醒來補跑每日 Ragic 員工同步。
 *
 * 正式站（Replit Autoscale）凌晨 03:00 的排程不一定會跑到，跑到一半也可能中斷：
 * 2026-10-30 之後每日同步沒有跑完過一次，11/03 那次開始後一直停在「執行中」。
 * 這裡在有請求進來時（每個程序最多每 10 分鐘看一次）檢查：
 * 最近一次應該跑的 03:00（台北）之後還沒有成功的同步，就在背景補跑一次。請求本身不等同步。
 * 同步沿用 runRagicSync 的鎖：別的執行個體正在跑時不會重複跑。
 */
import type { RequestHandler } from "express";
import type { JobState } from "../../core/health/types";
import { log } from "../../shared/log";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TAIPEI_OFFSET_MS = 8 * HOUR_MS;
const SLOT_HOUR = 3;
const RUN_IN_FLIGHT_MS = 15 * 60 * 1000;
export const CHECK_EVERY_MS = 10 * 60 * 1000;

/** 最近一次（含現在）應該跑每日同步的 03:00 台北時間。台北沒有日光節約時間。 */
export function lastDailySlot(now: Date): Date {
  const local = now.getTime() + TAIPEI_OFFSET_MS;
  const slot = Math.floor(local / DAY_MS) * DAY_MS + SLOT_HOUR * HOUR_MS - TAIPEI_OFFSET_MS;
  return new Date(slot <= now.getTime() ? slot : slot - DAY_MS);
}

/** 該補跑：那個 03:00 之後沒有成功的同步，而且沒有 15 分鐘內開始、還在跑的同步。 */
export function catchUpDue(state: Partial<JobState> | undefined, now: Date): boolean {
  const started = state?.lastStartedAt ? Date.parse(state.lastStartedAt) : Number.NaN;
  if (state?.lastStatus === "running" && now.getTime() - started < RUN_IN_FLIGHT_MS) return false;
  const success = state?.lastSuccessAt ? Date.parse(state.lastSuccessAt) : Number.NaN;
  return !(success >= lastDailySlot(now).getTime());
}

export interface RagicCatchUpDeps {
  enabled: boolean;
  readState: () => Promise<Partial<JobState> | undefined>;
  run: () => Promise<{ busy: boolean }>;
  now?: () => Date;
  log?: (message: string) => void;
}

export function ragicCatchUp(deps: RagicCatchUpDeps): RequestHandler {
  const now = deps.now ?? (() => new Date());
  const say = deps.log ?? ((message: string) => log(message, "ragic"));
  let lastCheck = Number.NEGATIVE_INFINITY;
  let checking = false;

  async function check(): Promise<void> {
    try {
      const state = await deps.readState();
      if (!catchUpDue(state, now())) return;
      say(`補跑每日 Ragic 員工同步（上次成功：${state?.lastSuccessAt ?? "無紀錄"}）`);
      const outcome = await deps.run();
      say(outcome.busy ? "Ragic 同步正在別處執行，已排入補跑" : "補跑每日 Ragic 員工同步完成");
    } catch (err: any) {
      say(`補跑每日 Ragic 員工同步失敗: ${err?.message ?? err}`);
    }
  }

  return (_req, _res, next) => {
    next();
    if (!deps.enabled || checking) return;
    const t = now().getTime();
    if (t - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = t;
    checking = true;
    void check().finally(() => {
      checking = false;
    });
  };
}
