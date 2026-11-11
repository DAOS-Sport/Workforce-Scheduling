/**
 * 健康燈號規則：全部是純函式，輸入狀態與現在時間，輸出一條管線的燈號與理由。
 * 規則：紅＝要立刻處理；黃＝之後處理，看不到訊號也算黃；綠＝正常。
 * 門檻是 2026-10-21 計畫裡的預設值，使用者確認前可調。
 */
import { addDays, formatTaipeiDateTime, taipeiClock, taipeiInstant } from "../time/taipei";
import type { IntegrationState, JobSchedule, JobState, Level, Pipeline } from "./types";

type Base = Pick<Pipeline, "id" | "name"> & { source?: string | null };

function pipeline(base: Base, level: Level, reason: string, state?: { lastSuccessAt?: string; lastFailureAt?: string; recoveredAt?: string }): Pipeline {
  // 恢復時間只對最近一次失敗有意義：之後又失敗了，舊的恢復時間就不再顯示。
  const recovered = state?.recoveredAt && state.lastFailureAt && Date.parse(state.recoveredAt) > Date.parse(state.lastFailureAt) ? { recoveredAt: state.recoveredAt } : {};
  return {
    id: base.id,
    name: base.name,
    level,
    reason,
    lastSuccessAt: state?.lastSuccessAt ?? null,
    lastFailureAt: state?.lastFailureAt ?? null,
    ...recovered,
    source: base.source ?? null,
  };
}

const ms = (iso?: string) => (iso ? Date.parse(iso) : NaN);
const at = (iso: string) => formatTaipeiDateTime(new Date(iso));
const MINUTE = 60_000;

/** 最近一次「應該已經跑完」的排定時間（排定時間＋寬限分鐘 ≤ now）。 */
export function lastExpectedRun(schedule: JobSchedule, now: Date, graceMinutes: number): Date {
  const cutoff = now.getTime() - graceMinutes * MINUTE;
  const today = taipeiClock(now).date;
  const slotsOn = (date: string): number[] => {
    if (schedule.kind === "daily") return [schedule.at];
    if (schedule.kind === "weekly") return taipeiClock(taipeiInstant(date, 12 * 60)).weekday === schedule.weekday ? [schedule.at] : [];
    const out: number[] = [];
    for (let m = schedule.from; m <= schedule.to; m += 30) out.push(m);
    return out;
  };
  for (let back = 0; back <= 8; back++) {
    const date = addDays(today, -back);
    const candidates = slotsOn(date).map((m) => taipeiInstant(date, m)).filter((d) => d.getTime() <= cutoff);
    if (candidates.length) return candidates[candidates.length - 1];
  }
  throw new Error("lastExpectedRun: schedule never fires within 8 days");
}

export interface ScheduledJobInput extends Base {
  schedule: JobSchedule;
  graceMinutes: number;
  enabled: boolean;
  schedulerActive: boolean;
  state?: JobState;
  now: Date;
}

export function evaluateScheduledJob(input: ScheduledJobInput): Pipeline {
  const { state, now } = input;
  if (!input.enabled) return pipeline(input, "green", "已停用（功能開關關閉）", state);
  if (!input.schedulerActive) return pipeline(input, "yellow", "無法觀測：這個環境不跑排程", state);
  if (state?.lastStatus === "running" && now.getTime() - ms(state.lastStartedAt) > 60 * MINUTE) {
    return pipeline(input, "red", `從 ${at(state.lastStartedAt!)} 開始執行，超過 60 分鐘還沒結束`, state);
  }
  const expected = lastExpectedRun(input.schedule, now, input.graceMinutes);
  const success = ms(state?.lastSuccessAt);
  const failure = ms(state?.lastFailureAt);
  if (failure >= expected.getTime() && !(success > failure)) {
    return pipeline(input, "red", `最近一次執行失敗（${at(state!.lastFailureAt!)}）：${state?.lastError ?? "未知錯誤"}`, state);
  }
  if (success >= expected.getTime()) return pipeline(input, "green", `最近一次成功 ${at(state!.lastSuccessAt!)}`, state);
  if (!state?.lastStartedAt) return pipeline(input, "yellow", "無法觀測：還沒有執行紀錄（剛上線或從未執行）", state);
  if (input.schedule.kind === "every30" && success >= expected.getTime() - 30 * MINUTE) {
    return pipeline(input, "yellow", `漏了 ${formatTaipeiDateTime(expected)} 那一輪`, state);
  }
  const last = state?.lastSuccessAt ? `，最後一次成功是 ${at(state.lastSuccessAt)}` : "";
  return pipeline(input, "red", `應該在 ${formatTaipeiDateTime(expected)} 執行，但沒有成功紀錄${last}`, state);
}

/** Ragic 員工同步：26 小時內要有一次成功。 */
export function evaluateSyncJob(input: Base & { state?: JobState; now: Date }): Pipeline {
  const { state, now } = input;
  if (!state?.lastStartedAt) return pipeline(input, "yellow", "無法觀測：還沒有同步紀錄", state);
  const success = ms(state.lastSuccessAt);
  const failure = ms(state.lastFailureAt);
  if (!(now.getTime() - success <= 26 * 60 * MINUTE)) {
    const last = state.lastSuccessAt ? `最後一次成功是 ${at(state.lastSuccessAt)}` : "從來沒有成功過";
    return pipeline(input, "red", `超過 26 小時沒有成功同步，${last}`, state);
  }
  if (failure > success) return pipeline(input, "yellow", `最近一次失敗（${at(state.lastFailureAt!)}）：${state.lastError ?? "未知錯誤"}；26 小時內有成功`, state);
  const errors = Number(state.lastSummary?.errors ?? 0);
  if (errors > 0) return pipeline(input, "yellow", `最近一次同步成功，但有 ${errors} 筆錯誤`, state);
  return pipeline(input, "green", `最近一次成功 ${at(state.lastSuccessAt!)}`, state);
}

/** 只靠按鈕觸發的工作：沒人按就沒有「該跑沒跑」，所以沒紀錄、很久沒跑都是綠；最近一次失敗才黃。 */
export function evaluateManualJob(input: Base & { state?: JobState }): Pipeline {
  const { state } = input;
  if (!state?.lastStartedAt) return pipeline(input, "green", "手動觸發的工作，還沒執行過", state);
  const success = ms(state.lastSuccessAt);
  const failure = ms(state.lastFailureAt);
  if (failure > (success || 0)) return pipeline(input, "yellow", `最近一次失敗（${at(state.lastFailureAt!)}）：${state.lastError ?? "未知錯誤"}`, state);
  return pipeline(input, "green", `最近一次成功 ${at(state.lastSuccessAt!)}`, state);
}

/** H01 webhook：沒有持久佇列，只能看最後一次處理結果。 */
export function evaluateWebhook(input: Base & { state?: JobState; now: Date }): Pipeline {
  const { state, now } = input;
  if (!state?.lastStartedAt) return pipeline(input, "yellow", "無法觀測：還沒收到過 webhook", state);
  const success = ms(state.lastSuccessAt);
  const failure = ms(state.lastFailureAt);
  if (failure > success || !state.lastSuccessAt) {
    const age = (now.getTime() - failure) / MINUTE;
    const level: Level = age > 60 ? "red" : "yellow";
    return pipeline(input, level, `最近一次處理失敗（${at(state.lastFailureAt!)}）：${state.lastError ?? "未知錯誤"}`, state);
  }
  return pipeline(input, "green", `最近一次成功 ${at(state.lastSuccessAt)}`, state);
}

/** 外部系統：連續 3 次失敗算紅，最近一次失敗算黃。 */
export function evaluateIntegration(input: Base & { state?: IntegrationState }): Pipeline {
  const { state } = input;
  if (!state || (!state.lastSuccessAt && !state.lastFailureAt)) return pipeline(input, "yellow", "無法觀測：還沒有呼叫紀錄", state);
  const failures = state.consecutiveFailures ?? 0;
  if (failures >= 3) return pipeline(input, "red", `連續 ${failures} 次失敗：${state.lastError ?? "未知錯誤"}`, state);
  if (ms(state.lastFailureAt) > (ms(state.lastSuccessAt) || 0)) return pipeline(input, "yellow", `最近一次失敗（${at(state.lastFailureAt!)}）：${state.lastError ?? "未知錯誤"}`, state);
  return pipeline(input, "green", `最近一次成功 ${at(state.lastSuccessAt!)}`, state);
}

export interface ClockCoverage {
  /** 今天已開始超過 30 分鐘的班數 */
  startedShifts: number;
  /** 其中員工今天有成功上班打卡的班數 */
  coveredShifts: number;
  attemptsToday: number;
  failuresToday: number;
}

/** 打卡：已開始的班有多少比例有人打卡。比例很低通常代表打卡入口壞了。 */
export function evaluateClockCoverage(input: Base & { coverage: ClockCoverage }): Pipeline {
  const c = input.coverage;
  const failRatio = c.attemptsToday > 0 ? c.failuresToday / c.attemptsToday : 0;
  const failNote = c.attemptsToday > 0 ? `；今天打卡 ${c.attemptsToday} 次、失敗 ${c.failuresToday} 次` : "";
  if (c.startedShifts === 0) return pipeline(input, "green", `今天還沒有已開始的班${failNote}`);
  const ratio = c.coveredShifts / c.startedShifts;
  const summary = `已開始的班 ${c.startedShifts} 個，有打卡的 ${c.coveredShifts} 個（${Math.round(ratio * 100)}%）${failNote}`;
  if (c.startedShifts >= 5 && ratio < 0.2) return pipeline(input, "red", summary);
  if (ratio < 0.5 || (c.attemptsToday >= 10 && failRatio > 0.2)) return pipeline(input, "yellow", summary);
  return pipeline(input, "green", summary);
}

/** 資料庫：查詢時間分級回報，避免把每次不同的毫秒數寫進理由。 */
export function evaluateDatabase(input: Base & { latencyMs: number | null; error?: string }): Pipeline {
  if (input.latencyMs === null) return pipeline(input, "red", `連不上資料庫：${input.error ?? "未知錯誤"}`);
  if (input.latencyMs < 500) return pipeline(input, "green", "查詢正常（< 500 ms）");
  if (input.latencyMs < 2000) return pipeline(input, "yellow", "查詢偏慢（500 ms 到 2 秒）");
  return pipeline(input, "red", "查詢超過 2 秒");
}

/** 國定假日表：還涵蓋 60 天以上算綠，剩不到 60 天算黃，已過期算紅。 */
export function evaluateHolidayTable(input: Base & { lastDate: string; today: string }): Pipeline {
  const days = Math.round((Date.parse(input.lastDate) - Date.parse(input.today)) / 86_400_000);
  if (days < 0) return pipeline(input, "red", `最後一天是 ${input.lastDate}，已過期 ${-days} 天，之後的國定假日不會被算進薪資工時`);
  if (days < 60) return pipeline(input, "yellow", `最後一天是 ${input.lastDate}，剩 ${days} 天就過期`);
  return pipeline(input, "green", `涵蓋到 ${input.lastDate}`);
}

export interface SecuritySignals {
  mcpTokenSet: boolean;
  mcpTokenDistinct: boolean;
  sessionSecretSet: boolean;
  lineChannelSecretSet: boolean;
}

/** 安全設定：設定值本身就是訊號，缺一項就紅。只回報缺哪些，不回報值。 */
export function evaluateSecurity(input: Base & { signals: SecuritySignals }): Pipeline {
  const s = input.signals;
  const problems = [
    !s.mcpTokenSet && "沒有設定 MCP_TOKEN（/mcp 無法使用）",
    s.mcpTokenSet && !s.mcpTokenDistinct && "MCP_TOKEN 跟 INTERNAL_API_TOKEN 相同",
    !s.sessionSecretSet && "沒有設定 SESSION_SECRET",
    !s.lineChannelSecretSet && "沒有設定 LINE_CHANNEL_SECRET（LINE 簽章可被偽造）",
  ].filter(Boolean) as string[];
  if (problems.length) return pipeline(input, "red", problems.join("；"));
  return pipeline(input, "green", "必要的安全設定都有設");
}

export interface AuditActorSignals {
  sharedPasswordEnabled: boolean;
  sharedWrites24h: number;
  disabledSharedWrites24h: number;
  missingAudits24h: number;
  failures24h: number;
  witnessAvailable: boolean;
}

export function evaluateAuditActor(input: Base & { signals?: AuditActorSignals }): Pipeline {
  const s = input.signals;
  if (!s) return pipeline(input, "yellow", "無法觀測：操作異動見證尚未完整安裝");
  if (s.missingAudits24h > 0) return pipeline(input, "red", `最近 24 小時有 ${s.missingAudits24h} 筆異動缺少同交易操作紀錄`);
  if (s.failures24h > 0) return pipeline(input, "red", "最近 24 小時操作紀錄寫入失敗");
  if (s.disabledSharedWrites24h > 0) return pipeline(input, "red", `共用密碼關閉後仍有 ${s.disabledSharedWrites24h} 筆異動`);
  if (!s.witnessAvailable) return pipeline(input, "yellow", "無法觀測：操作異動見證尚未完整安裝");
  if (s.sharedPasswordEnabled && s.sharedWrites24h > 0) return pipeline(input, "yellow", `共用密碼仍開啟，最近 24 小時使用它寫入 ${s.sharedWrites24h} 筆`);
  return pipeline(input, "green", "最近 24 小時異動都有操作紀錄，未發現停用後的共用密碼寫入");
}
