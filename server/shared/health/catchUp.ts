/**
 * 醒來補跑漏掉的排程。
 *
 * 排程寫在程式裡（node-cron），只有排定時間那一刻有執行個體醒著才會跑。正式站是 Replit Autoscale，
 * 實際看到的是：2026-10-30 之後每日 Ragic 同步沒跑完過，11/04、11/05 19:00 的明日班表推播連開始紀錄都沒有。
 * 這裡在有請求進來時（每個程序最多每 10 分鐘看一次）逐一檢查：最近一次排定時間之後沒有成功、而且還沒過截止時間，
 * 就在背景補跑一次，請求本身不等。排定時間取自健康燈號用的同一張表，所以燈號說「漏了」的那一輪，就是這裡補的那一輪。
 * 補跑跟排程走同一個工作鎖；推播另有每人一筆的佔位紀錄，所以撞上排程或別的執行個體也只跑一次、每人只收到一則。
 */
import type { RequestHandler } from "express";
import { lastExpectedRun } from "../../core/health/rules";
import { taipeiClock, taipeiInstant } from "../../core/time/taipei";
import type { JobSchedule, JobState } from "../../core/health/types";
import { outsideRequest, runWithRequestId } from "../http/requestId";
import { log } from "../log";
import { recordLog } from "../logging/collector";
import { withPipeline } from "../logging/context";

/** A job that runs at one time of day; a missed every-30-minutes reminder is stale by the next round, so it is not caught up. */
export type SlotSchedule = Exclude<JobSchedule, { kind: "every30" }>;

export interface CatchUpJob {
  /** The job's name in the health record. */
  id: string;
  schedule: SlotSchedule;
  /** Minutes after midnight (Taipei) on the slot's day after which a missed run is dropped. Omitted: kept until the next slot. */
  closesAt?: number;
  run: () => Promise<{ busy: boolean }>;
}

export const CHECK_EVERY_MS = 10 * 60 * 1000;
const RUN_IN_FLIGHT_MS = 15 * 60 * 1000;

const time = (iso?: string) => (iso ? Date.parse(iso) : Number.NaN);

/** Due: the latest slot has no success after it, it has not closed, and no run started in the last 15 minutes is still going. */
export function catchUpDue(job: Pick<CatchUpJob, "schedule" | "closesAt">, state: Partial<JobState> | undefined, now: Date): boolean {
  if (state?.lastStatus === "running" && now.getTime() - time(state.lastStartedAt) < RUN_IN_FLIGHT_MS) return false;
  const slot = lastExpectedRun(job.schedule, now, 0);
  if (job.closesAt !== undefined && now.getTime() >= taipeiInstant(taipeiClock(slot).date, job.closesAt).getTime()) return false;
  return !(time(state?.lastSuccessAt) >= slot.getTime());
}

export interface CatchUpDeps {
  jobs: readonly CatchUpJob[];
  readState: (id: string) => Promise<Partial<JobState> | undefined>;
  now?: () => Date;
  log?: (message: string) => void;
}

export function catchUpMissedRuns(deps: CatchUpDeps): RequestHandler {
  const now = deps.now ?? (() => new Date());
  const say = (message: string) => {
    (deps.log ?? ((text: string) => log(text, "catch-up")))(message);
  };
  const inFlight = new Set<string>();
  let lastCheck = Number.NEGATIVE_INFINITY;
  let checking = false;

  function start(job: CatchUpJob, lastSuccessAt: string | undefined): void {
    inFlight.add(job.id);
    recordLog("info", "catch-up.started", "scheduler.catch-up");
    say(`補跑 ${job.id}（上次成功：${lastSuccessAt ?? "無紀錄"}）`);
    // The job's log lines carry this label in place of a request id, so a caught-up run is easy to find in the deployment log.
    runWithRequestId(`catch-up.${job.id}`, () => job.run())
      .then(
        (outcome) => {
          recordLog("info", outcome.busy ? "catch-up.busy" : "catch-up.completed", "scheduler.catch-up");
          say(outcome.busy ? `${job.id} 正在別處執行，這次不補` : `補跑 ${job.id} 完成`);
        },
        (err: any) => {
          recordLog("error", `catch-up.failed ${job.id}: ${err?.message ?? err}`, "scheduler.catch-up");
          say(`補跑 ${job.id} 失敗: ${err?.message ?? err}`);
        },
      )
      .finally(() => inFlight.delete(job.id));
  }

  async function check(): Promise<void> {
    for (const job of deps.jobs) {
      if (inFlight.has(job.id)) continue;
      try {
        const state = await deps.readState(job.id);
        if (catchUpDue(job, state, now())) start(job, state?.lastSuccessAt);
      } catch (err: any) {
        recordLog("error", `catch-up.check-failed ${job.id}: ${err?.message ?? err}`, "scheduler.catch-up");
        say(`補跑 ${job.id} 檢查失敗: ${err?.message ?? err}`);
      }
    }
  }

  return (req, _res, next) => {
    next();
    // A watchdog poll must never start business work or make an external call.
    if (/^\/api\/(?:admin\/)?health(?:\/|$)/i.test(req.path ?? "")) return;
    if (deps.jobs.length === 0 || checking) return;
    const t = now().getTime();
    if (t - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = t;
    checking = true;
    void outsideRequest(() => withPipeline("scheduler.catch-up", check)).finally(() => {
      checking = false;
    });
  };
}
