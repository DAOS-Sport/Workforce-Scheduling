import { describe, expect, it, vi } from "vitest";
import { CHECK_EVERY_MS, catchUpDue, lastDailySlot, ragicCatchUp } from "./ragicCatchUp";

const at = (iso: string) => new Date(iso);

describe("lastDailySlot: the 03:00 Taipei run the daily sync should have covered", () => {
  it("is today's 03:00 Taipei once it has passed", () => {
    expect(lastDailySlot(at("2026-11-05T04:50:00Z")).toISOString()).toBe("2026-11-04T19:00:00.000Z");
  });

  it("is yesterday's 03:00 Taipei one second before today's", () => {
    expect(lastDailySlot(at("2026-11-04T18:59:59Z")).toISOString()).toBe("2026-11-03T19:00:00.000Z");
  });

  it("is the slot itself at exactly 03:00 Taipei", () => {
    expect(lastDailySlot(at("2026-11-04T19:00:00Z")).toISOString()).toBe("2026-11-04T19:00:00.000Z");
  });
});

describe("catchUpDue", () => {
  const now = at("2026-11-05T04:50:00Z");

  it("is due when no sync has ever been recorded", () => {
    expect(catchUpDue(undefined, now)).toBe(true);
  });

  it("is due when the last success is older than today's 03:00 Taipei", () => {
    expect(catchUpDue({ lastStatus: "success", lastSuccessAt: "2026-10-30T03:12:25.349Z" }, now)).toBe(true);
  });

  it("is not due when a sync succeeded after today's 03:00 Taipei", () => {
    expect(catchUpDue({ lastStatus: "success", lastSuccessAt: "2026-11-04T19:00:40.000Z" }, now)).toBe(false);
  });

  it("is not due while a sync started in the last 15 minutes is still running", () => {
    expect(catchUpDue({ lastStatus: "running", lastStartedAt: "2026-11-05T04:45:00Z", lastSuccessAt: "2026-10-30T03:12:25Z" }, now)).toBe(false);
  });

  it("is due when a run was left 'running' by a process that went away (the 11/03 case)", () => {
    expect(catchUpDue({ lastStatus: "running", lastStartedAt: "2026-11-02T19:00:03.714Z", lastSuccessAt: "2026-10-30T03:12:25.349Z" }, now)).toBe(true);
  });
});

function harness(options: { enabled?: boolean; state?: () => Promise<any>; run?: () => Promise<{ busy: boolean }> } = {}) {
  let clock = at("2026-11-05T04:50:00Z").getTime();
  const readState = vi.fn(options.state ?? (async () => ({ lastStatus: "success", lastSuccessAt: "2026-10-30T03:12:25Z" })));
  const run = vi.fn(options.run ?? (async () => ({ busy: false })));
  const log = vi.fn();
  const handler = ragicCatchUp({ enabled: options.enabled ?? true, readState, run, now: () => new Date(clock), log });
  const request = () => {
    const next = vi.fn();
    handler({} as any, {} as any, next);
    return next;
  };
  return { readState, run, log, request, advance: (ms: number) => { clock += ms; } };
}

describe("ragicCatchUp middleware", () => {
  it("lets the request through at once, without waiting for the sync", () => {
    const h = harness({ run: () => new Promise(() => {}) });
    const next = h.request();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does nothing when it is switched off (dev, or the Ragic sync flag is off)", async () => {
    const h = harness({ enabled: false });
    h.request();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.readState).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
  });

  it("starts the missed daily sync on the first request, once", async () => {
    const h = harness();
    h.request();
    await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));
    h.request();
    h.request();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.readState).toHaveBeenCalledTimes(1);
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("does not start a second sync while the first is still going, even after the check interval", async () => {
    const h = harness({ run: () => new Promise(() => {}) });
    h.request();
    await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));
    h.advance(CHECK_EVERY_MS + 1);
    h.request();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("checks again after the interval and leaves a fresh sync alone", async () => {
    let state: any = { lastStatus: "success", lastSuccessAt: "2026-10-30T03:12:25Z" };
    const h = harness({ state: async () => state });
    h.request();
    await vi.waitFor(() => expect(h.run).toHaveBeenCalledTimes(1));
    state = { lastStatus: "success", lastSuccessAt: "2026-11-05T04:51:00Z" };
    h.advance(CHECK_EVERY_MS + 1);
    h.request();
    await vi.waitFor(() => expect(h.readState).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("does not run when the daily sync already succeeded today", async () => {
    const h = harness({ state: async () => ({ lastStatus: "success", lastSuccessAt: "2026-11-04T19:00:40Z" }) });
    h.request();
    await vi.waitFor(() => expect(h.readState).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.run).not.toHaveBeenCalled();
  });

  it("logs a failed state read or a failed sync instead of throwing, and tries again after the interval", async () => {
    let fail = true;
    const h = harness({
      state: async () => {
        if (fail) throw new Error("db down");
        return undefined;
      },
      run: async () => {
        throw new Error("ragic down");
      },
    });
    const next = h.request();
    expect(next).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(h.log).toHaveBeenCalledWith(expect.stringContaining("db down")));
    fail = false;
    h.advance(CHECK_EVERY_MS + 1);
    h.request();
    await vi.waitFor(() => expect(h.log).toHaveBeenCalledWith(expect.stringContaining("ragic down")));
    expect(h.run).toHaveBeenCalledTimes(1);
  });
});
