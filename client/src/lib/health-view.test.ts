import { describe, expect, it } from "vitest";
import { ago, apiPipeline, formatTaipei, groupOf, groupPipelines, recoveredAt, worstLevel, type Pipeline } from "./health-view";

const pipe = (id: string, level: Pipeline["level"] = "green", extra: Partial<Pipeline> = {}): Pipeline => ({
  id,
  name: id,
  level,
  reason: "",
  lastSuccessAt: null,
  lastFailureAt: null,
  source: null,
  ...extra,
});

describe("groupOf", () => {
  it("puts every pipeline the health report builds today into the group an admin expects", () => {
    expect(groupOf("database")).toBe("database");
    for (const id of ["integration.line", "integration.mail", "integration.ragic", "integration.enrollment", "ragic.employee-sync", "ragic.h01-webhook"]) {
      expect([id, groupOf(id)]).toEqual([id, "external"]);
    }
    for (const id of ["push.shift-reminders", "push.weekly-schedule", "push.missing-clock", "push.availability-reminder", "report.weekly-late"]) {
      expect([id, groupOf(id)]).toEqual([id, "jobs"]);
    }
    for (const id of ["clock.coverage", "holiday-table", "security-config", "api", "something.new"]) {
      expect([id, groupOf(id)]).toEqual([id, "app"]);
    }
  });
});

describe("groupPipelines", () => {
  it("lists the worst first inside a group and keeps report order among equals", () => {
    const groups = groupPipelines([pipe("push.a", "green"), pipe("push.b", "red"), pipe("push.c", "yellow"), pipe("push.d", "red"), pipe("database", "green")]);
    expect(groups.find((g) => g.key === "jobs")!.items.map((p) => p.id)).toEqual(["push.b", "push.d", "push.c", "push.a"]);
    expect(groups.find((g) => g.key === "database")!.items.map((p) => p.id)).toEqual(["database"]);
    expect(groups.map((g) => g.key)).toEqual(["app", "database", "external", "jobs"]);
  });
});

describe("recoveredAt", () => {
  it("is the stamp the server recorded when it is later than the latest failure, whatever the latest success is", () => {
    expect(recoveredAt({ lastFailureAt: "2026-11-03T01:00:00.000Z", recoveredAt: "2026-11-03T01:05:00.000Z" })).toBe("2026-11-03T01:05:00.000Z");
  });
  it("is null with no stamp, with no failure, with a stamp from an earlier outage, or when the times tie", () => {
    expect(recoveredAt({ lastFailureAt: "2026-11-03T01:00:00.000Z" })).toBeNull();
    expect(recoveredAt({ lastFailureAt: null, recoveredAt: "2026-11-03T01:05:00.000Z" })).toBeNull();
    expect(recoveredAt({ lastFailureAt: "2026-11-03T02:00:00.000Z", recoveredAt: "2026-11-03T01:05:00.000Z" })).toBeNull();
    expect(recoveredAt({ lastFailureAt: "2026-11-03T01:00:00.000Z", recoveredAt: "2026-11-03T01:00:00.000Z" })).toBeNull();
  });
});

describe("formatTaipei and ago", () => {
  it("shows Taipei wall-clock time whatever time zone the viewer is in", () => {
    expect(formatTaipei("2026-11-03T02:30:00.000Z")).toBe("2026-11-03 10:30");
    expect(formatTaipei("2026-11-03T16:30:00.000Z")).toBe("2026-11-04 00:30");
    expect(formatTaipei(null)).toBe("—");
    expect(formatTaipei("not a date")).toBe("not a date");
  });
  it("says how long ago, and treats a slightly future time as just now", () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    expect(ago("2026-11-03T11:59:30.000Z", now)).toBe("剛剛");
    expect(ago("2026-11-03T11:55:00.000Z", now)).toBe("5 分鐘前");
    expect(ago("2026-11-03T09:00:00.000Z", now)).toBe("3 小時前");
    expect(ago("2026-10-30T12:00:00.000Z", now)).toBe("4 天前");
    expect(ago("2026-11-03T12:00:20.000Z", now)).toBe("剛剛");
    expect(ago(null, now)).toBe("");
  });
});

describe("apiPipeline and worstLevel", () => {
  const report = { system: "s", build: "b", checkedAt: "2026-11-03T02:30:00.000Z", overall: "green" as const, pipelines: [] };
  it("is red with the error when the report could not be fetched, even if an older report is still held", () => {
    const p = apiPipeline({ report, error: "500: boom", fetchedAt: "2026-11-03T02:30:00.000Z", failedAt: "2026-11-03T02:31:00.000Z" });
    expect(p.level).toBe("red");
    expect(p.reason).toContain("500: boom");
    expect(recoveredAt(p)).toBeNull();
  });
  it("is green and shows a recovery once a fetch succeeds after the failure", () => {
    const p = apiPipeline({ report, error: null, fetchedAt: "2026-11-03T02:40:00.000Z", failedAt: "2026-11-03T02:31:00.000Z", recoveredAt: "2026-11-03T02:32:00.000Z" });
    expect(p.level).toBe("green");
    expect(recoveredAt(p)).toBe("2026-11-03T02:32:00.000Z");
  });
  it("worstLevel picks red over yellow over green", () => {
    expect(worstLevel([])).toBe("green");
    expect(worstLevel(["green", "yellow"])).toBe("yellow");
    expect(worstLevel(["yellow", "red", "green"])).toBe("red");
  });
});
