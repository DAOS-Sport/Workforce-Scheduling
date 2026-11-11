import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLogSink, flushLogs } from "../shared/logging/collector";
import type { LogEntry } from "../shared/logging/buffer";
import { registerCronJobs } from "./scheduler";

const cron = vi.hoisted(() => ({
  callbacks: new Map<string, () => Promise<void>>(),
  schedule: vi.fn(),
  runJob: vi.fn(),
  runRagicSync: vi.fn(),
  drainRagicEvents: vi.fn(),
}));
vi.mock("node-cron", () => ({ default: { schedule: cron.schedule } }));
vi.mock("../config/env", () => ({ IS_PRODUCTION: true }));
vi.mock("../config/featureFlags", () => ({ featureFlags: {
  ragicSync: true, dailyShiftReminder: true, missingClockCheck: true,
  weeklyShiftReminder: true, availabilityReminder: true, weeklyLateReport: true,
} }));
vi.mock("../modules/ragic/ragic.service", () => ({
  runRagicSync: cron.runRagicSync, drainRagicEvents: cron.drainRagicEvents,
}));
vi.mock("../modules/line/linePush.service", () => ({
  sendShiftReminders: vi.fn(), checkMissingClockIn: vi.fn(), sendWeeklySchedulePush: vi.fn(),
  sendWeeklyLateReport: vi.fn(), sendAvailabilityReminders: vi.fn(),
}));
vi.mock("../modules/errors/errors.service", () => ({ purgeOldErrors: vi.fn() }));
vi.mock("../shared/health/runJob", () => ({ runJob: cron.runJob }));

const jobs = [
  ["0 3 * * *", "ragic.employee-sync"],
  ["0 19 * * *", "push.shift-reminders"],
  ["*/30 6-21 * * *", "push.missing-clock"],
  ["0 12 * * 0", "push.weekly-schedule"],
  ["0 10 * * *", "push.availability-reminder"],
  ["0 9 * * 1", "report.weekly-late"],
  ["0 4 * * *", "errors.purge"],
] as const;

let rows: LogEntry[];
let stop: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  cron.callbacks.clear();
  cron.schedule.mockImplementation((expression: string, run: () => Promise<void>) => {
    cron.callbacks.set(expression, run);
    return {};
  });
  cron.runJob.mockResolvedValue({ busy: true });
  cron.runRagicSync.mockResolvedValue({ busy: true });
  cron.drainRagicEvents.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  stop = configureLogSink(async (batch) => { rows.push(...batch); });
  registerCronJobs();
});
afterEach(async () => {
  await flushLogs();
  stop();
  vi.restoreAllMocks();
});

describe("cron busy/failure log sink", () => {
  it.each(jobs)("records busy %s as a warning under %s", async (expression, pipeline) => {
    await cron.callbacks.get(expression)!();
    await flushLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ level: "warn", pipeline });
    expect(rows[0].message).toContain("本輪略過");
  });

  it.each([...jobs, ["*/5 * * * *", "ragic.employee-sync"]] as const)(
    "records thrown %s as a redacted error under %s", async (expression, pipeline) => {
      const failure = new Error("synthetic dependency failure token=synthetic-secret user@example.test");
      cron.runJob.mockRejectedValue(failure);
      cron.runRagicSync.mockRejectedValue(failure);
      cron.drainRagicEvents.mockRejectedValue(failure);
      await cron.callbacks.get(expression)!();
      await flushLogs();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ level: "error", pipeline });
      expect(rows[0].message).toContain("synthetic dependency failure");
      expect(rows[0].message).not.toContain("synthetic-secret");
      expect(rows[0].message).not.toContain("user@example.test");
      expect(rows[0].message).toContain("[REDACTED]");
    },
  );
});

