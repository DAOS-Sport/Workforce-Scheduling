import { describe, expect, it, vi } from "vitest";
import { currentRequestId, runWithRequestId } from "../http/requestId";
import { CHECK_EVERY_MS, catchUpDue, catchUpMissedRuns, type CatchUpJob } from "./catchUp";

const at = (iso: string) => new Date(iso);
const ragic = { schedule: { kind: "daily", at: 3 * 60 } } as const;
const shiftReminders = { schedule: { kind: "daily", at: 19 * 60 }, closesAt: 23 * 60 } as const;
const weekly = { schedule: { kind: "weekly", weekday: 0, at: 12 * 60 }, closesAt: 23 * 60 } as const;

describe("catchUpDue: a daily job kept until the next slot (the Ragic sync)", () => {
  const now = at("2026-11-05T04:50:00Z"); // 12:50 Taipei

  it("is due when no run has ever been recorded", () => {
    expect(catchUpDue(ragic, undefined, now)).toBe(true);
  });

  it("is due when the last success is older than today's 03:00 Taipei", () => {
    expect(catchUpDue(ragic, { lastStatus: "success", lastSuccessAt: "2026-10-30T03:12:25.349Z" }, now)).toBe(true);
  });

  it("is not due when a run succeeded after today's 03:00 Taipei", () => {
    expect(catchUpDue(ragic, { lastStatus: "success", lastSuccessAt: "2026-11-04T19:00:40.000Z" }, now)).toBe(false);
  });

  it("counts the slot from 03:00 itself: one second before, yesterday's slot is the one that matters", () => {
    const yesterdaysSuccess = { lastStatus: "success", lastSuccessAt: "2026-11-03T19:00:40.000Z" } as const;
    expect(catchUpDue(ragic, yesterdaysSuccess, at("2026-11-04T18:59:59Z"))).toBe(false);
    expect(catchUpDue(ragic, yesterdaysSuccess, at("2026-11-04T19:00:00Z"))).toBe(true);
  });

  it("is not due while a run started in the last 15 minutes is still going", () => {
    expect(catchUpDue(ragic, { lastStatus: "running", lastStartedAt: "2026-11-05T04:45:00Z", lastSuccessAt: "2026-10-30T03:12:25Z" }, now)).toBe(false);
  });

  it("is due when a run was left 'running' by a process that went away (the 11/03 case)", () => {
    expect(catchUpDue(ragic, { lastStatus: "running", lastStartedAt: "2026-11-02T19:00:03.714Z", lastSuccessAt: "2026-10-30T03:12:25.349Z" }, now)).toBe(true);
  });

  it("is due again after a failed run, until one succeeds", () => {
    expect(catchUpDue(ragic, { lastStatus: "failed", lastFailureAt: "2026-11-05T04:40:00Z", lastSuccessAt: "2026-11-03T21:00:00Z" }, now)).toBe(true);
  });
});

describe("catchUpDue: the 19:00 shift reminders, which close at 23:00", () => {
  const lastNight = { lastStatus: "success", lastSuccessAt: "2026-11-03T11:00:30.045Z" } as const; // 11/03 19:00 Taipei

  it("is not due before tonight's 19:00, because yesterday's slot has closed", () => {
    expect(catchUpDue(shiftReminders, lastNight, at("2026-11-05T10:59:00Z"))).toBe(false); // 11/05 18:59
  });

  it("is due between 19:00 and 23:00 when tonight's run has not succeeded", () => {
    expect(catchUpDue(shiftReminders, lastNight, at("2026-11-05T11:00:00Z"))).toBe(true); // 19:00
    expect(catchUpDue(shiftReminders, lastNight, at("2026-11-05T14:59:59Z"))).toBe(true); // 22:59:59
  });

  it("is no longer due from 23:00: tomorrow's shifts would be announced after midnight", () => {
    expect(catchUpDue(shiftReminders, lastNight, at("2026-11-05T15:00:00Z"))).toBe(false); // 23:00
    expect(catchUpDue(shiftReminders, lastNight, at("2026-11-05T22:00:00Z"))).toBe(false); // 11/06 06:00
  });

  it("is not due once tonight's run succeeded", () => {
    expect(catchUpDue(shiftReminders, { lastStatus: "success", lastSuccessAt: "2026-11-05T11:00:26Z" }, at("2026-11-05T13:00:00Z"))).toBe(false);
  });
});

describe("catchUpDue: a weekly job", () => {
  const lastWeek = { lastStatus: "success", lastSuccessAt: "2026-11-01T04:00:20Z" } as const; // Sunday 11/01 12:00 Taipei

  it("is due on the Sunday afternoon when that Sunday's noon run is missing", () => {
    expect(catchUpDue(weekly, lastWeek, at("2026-11-08T06:00:00Z"))).toBe(true); // Sunday 11/08 14:00
  });

  it("is not due on the Monday after: the Sunday slot closed at 23:00", () => {
    expect(catchUpDue(weekly, lastWeek, at("2026-11-09T02:00:00Z"))).toBe(false); // Monday 10:00
  });

  it("is not due midweek", () => {
    expect(catchUpDue(weekly, lastWeek, at("2026-11-04T06:00:00Z"))).toBe(false); // Wednesday
  });
});

function harness(options: { jobs?: Array<Partial<CatchUpJob> & { id: string }>; state?: (id: string) => Promise<any>; log?: (message: string) => void } = {}) {
  let clock = at("2026-11-05T04:50:00Z").getTime();
  const runs: Record<string, ReturnType<typeof vi.fn>> = {};
  const jobs: CatchUpJob[] = (options.jobs ?? [{ id: "ragic.sync" }]).map((job) => {
    runs[job.id] = vi.fn(job.run ?? (async () => ({ busy: false })));
    return { schedule: ragic.schedule, ...job, run: runs[job.id] } as CatchUpJob;
  });
  const readState = vi.fn(options.state ?? (async () => ({ lastStatus: "success", lastSuccessAt: "2026-10-30T03:12:25Z" })));
  const log = vi.fn(options.log ?? (() => undefined));
  const handler = catchUpMissedRuns({ jobs, readState, now: () => new Date(clock), log });
  const request = () => {
    const next = vi.fn();
    handler({} as any, {} as any, next);
    return next;
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { runs, readState, log, request, settle, advance: (ms: number) => { clock += ms; } };
}

describe("catchUpMissedRuns middleware", () => {
  it("lets the request through at once, without waiting for the run", () => {
    const h = harness({ jobs: [{ id: "ragic.sync", run: () => new Promise(() => {}) }] });
    expect(h.request()).toHaveBeenCalledTimes(1);
  });

  it("files the job's log lines under its own catch-up label, not under the request that triggered it", async () => {
    let seen: string | undefined = "not run";
    const loggedUnder: Array<string | undefined> = [];
    const h = harness({
      jobs: [{ id: "ragic.sync", run: async () => { seen = currentRequestId(); return { busy: false }; } }],
      log: () => void loggedUnder.push(currentRequestId()),
    });
    runWithRequestId("req-of-a-visitor", () => h.request());
    await vi.waitFor(() => expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1));
    expect(seen).toBe("catch-up.ragic.sync");
    expect(loggedUnder.length).toBeGreaterThan(0);
    expect(loggedUnder).not.toContain("req-of-a-visitor");
  });

  it("does nothing when there are no jobs (development, or every flag off)", async () => {
    const h = harness({ jobs: [] });
    h.request();
    await h.settle();
    expect(h.readState).not.toHaveBeenCalled();
  });

  it("starts a missed run on the first request, once", async () => {
    const h = harness();
    h.request();
    await vi.waitFor(() => expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1));
    h.request();
    h.request();
    await h.settle();
    expect(h.readState).toHaveBeenCalledTimes(1);
    expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1);
  });

  it("checks every job and starts only the ones that are due", async () => {
    const h = harness({
      jobs: [{ id: "ragic.sync" }, { id: "push.shift-reminders", ...shiftReminders }],
      state: async (id) => (id === "ragic.sync" ? { lastStatus: "success", lastSuccessAt: "2026-11-04T19:00:40Z" } : undefined),
    });
    h.advance(6 * 60 * 60 * 1000 + 10 * 60 * 1000); // 19:00 Taipei
    h.request();
    await vi.waitFor(() => expect(h.runs["push.shift-reminders"]).toHaveBeenCalledTimes(1));
    await h.settle();
    expect(h.runs["ragic.sync"]).not.toHaveBeenCalled();
  });

  it("does not start a second run of a job that is still going, even after the check interval", async () => {
    const h = harness({ jobs: [{ id: "ragic.sync", run: () => new Promise(() => {}) }] });
    h.request();
    await vi.waitFor(() => expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1));
    h.advance(CHECK_EVERY_MS + 1);
    h.request();
    await h.settle();
    expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1);
  });

  it("a job that hangs does not keep the other jobs from being caught up", async () => {
    let pushState: any = { lastStatus: "success", lastSuccessAt: "2026-11-05T11:00:00Z" };
    const h = harness({
      jobs: [{ id: "ragic.sync", run: () => new Promise(() => {}) }, { id: "push.shift-reminders", ...shiftReminders }],
      state: async (id) => (id === "ragic.sync" ? undefined : pushState),
    });
    h.request();
    await vi.waitFor(() => expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1));
    h.advance(6 * 60 * 60 * 1000 + 10 * 60 * 1000); // next evening slot reached; push now due
    pushState = { lastStatus: "success", lastSuccessAt: "2026-11-04T11:00:00Z" };
    h.request();
    await vi.waitFor(() => expect(h.runs["push.shift-reminders"]).toHaveBeenCalledTimes(1));
  });

  it("checks again after the interval and leaves a job that has since succeeded alone", async () => {
    let state: any = { lastStatus: "success", lastSuccessAt: "2026-10-30T03:12:25Z" };
    const h = harness({ state: async () => state });
    h.request();
    await vi.waitFor(() => expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1));
    state = { lastStatus: "success", lastSuccessAt: "2026-11-05T04:51:00Z" };
    h.advance(CHECK_EVERY_MS + 1);
    h.request();
    await vi.waitFor(() => expect(h.readState).toHaveBeenCalledTimes(2));
    await h.settle();
    expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1);
  });

  it("logs a failed state read or a failed run instead of throwing, and tries again after the interval", async () => {
    let fail = true;
    const h = harness({
      jobs: [{ id: "ragic.sync", run: async () => { throw new Error("ragic down"); } }],
      state: async () => {
        if (fail) throw new Error("db down");
        return undefined;
      },
    });
    expect(h.request()).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(h.log).toHaveBeenCalledWith(expect.stringContaining("db down")));
    fail = false;
    h.advance(CHECK_EVERY_MS + 1);
    h.request();
    await vi.waitFor(() => expect(h.log).toHaveBeenCalledWith(expect.stringContaining("ragic down")));
    expect(h.runs["ragic.sync"]).toHaveBeenCalledTimes(1);
  });
});
