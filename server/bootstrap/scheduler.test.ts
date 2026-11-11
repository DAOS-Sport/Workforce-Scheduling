import { afterEach, describe, expect, it, vi } from "vitest";
import { SCHEDULED_JOBS } from "../core/health/report";
vi.mock("../infra/db", () => ({ db: {}, pool: {} }));

async function catchUpJobsWith(env: { production: boolean; flags: Record<string, boolean> }) {
  vi.resetModules();
  vi.doMock("../config/env", async (original) => ({ ...(await original<object>()), IS_PRODUCTION: env.production }));
  vi.doMock("../config/featureFlags", () => ({ featureFlags: env.flags }));
  const { catchUpJobs } = await import("./scheduler");
  return catchUpJobs();
}

const productionFlags = {
  ragicSync: true,
  dailyShiftReminder: true,
  weeklyShiftReminder: true,
  missingClockCheck: true,
  weeklyLateReport: true,
  availabilityReminder: false,
};

afterEach(() => {
  vi.doUnmock("../config/env");
  vi.doUnmock("../config/featureFlags");
});

// Each case imports the scheduler afresh, with its whole module graph; that alone can take seconds on a loaded machine.
describe("catchUpJobs: what production runs on wake-up after a missed slot", { timeout: 60_000 }, () => {
  it("catches up the Ragic sync, the slot pushes whose flag is on, and the error purge; never the every-30-minutes reminder", async () => {
    const jobs = await catchUpJobsWith({ production: true, flags: productionFlags });
    expect(jobs.map((j) => j.id)).toEqual(["ragic.sync", "push.shift-reminders", "push.weekly-schedule", "report.weekly-late", "errors.purge"]);
  });

  it("takes each push's slot from the table the health lights read, and closes it at 23:00", async () => {
    const jobs = await catchUpJobsWith({ production: true, flags: productionFlags });
    for (const job of jobs.filter((j) => j.id.startsWith("push.") || j.id.startsWith("report."))) {
      expect(job.schedule).toEqual(SCHEDULED_JOBS.find((s) => s.id === job.id)?.schedule);
      expect(job.closesAt).toBe(23 * 60);
    }
    const ragic = jobs.find((j) => j.id === "ragic.sync");
    expect(ragic?.schedule).toEqual({ kind: "daily", at: 3 * 60 });
    expect(ragic?.closesAt).toBeUndefined();
  });

  it("follows the flags: the availability reminder joins when its flag is on, the Ragic sync leaves when its flag is off", async () => {
    const jobs = await catchUpJobsWith({ production: true, flags: { ...productionFlags, availabilityReminder: true, ragicSync: false } });
    expect(jobs.map((j) => j.id)).toContain("push.availability-reminder");
    expect(jobs.map((j) => j.id)).not.toContain("ragic.sync");
  });

  it("catches up nothing outside production", async () => {
    expect(await catchUpJobsWith({ production: false, flags: productionFlags })).toEqual([]);
  });
});
