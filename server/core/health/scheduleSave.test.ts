import { describe, expect, it } from "vitest";
import { evaluateScheduleSave } from "./rules";

const now = new Date("2026-11-11T04:00:00Z");
const before = (ms: number) => new Date(now.getTime() - ms).toISOString();
const hour = 3_600_000;
const base = { id: "schedule.save", name: "排班儲存", source: "app_errors", now };

describe("schedule save watchdog", () => {
  it("is green when no relevant error exists", () => {
    expect(evaluateScheduleSave(base)).toMatchObject({ level: "green", lastFailureAt: null });
  });

  it.each([
    [0, "red"],
    [hour, "red"],
    [hour + 1, "yellow"],
    [24 * hour, "yellow"],
    [24 * hour + 1, "green"],
  ])("critical failure %i ms ago is %s", (age, level) => {
    const p = evaluateScheduleSave({ ...base, state: { lastCriticalAt: before(age as number) } });
    expect(p.level).toBe(level);
  });

  it.each([[0, "yellow"], [24 * hour, "yellow"], [24 * hour + 1, "green"]])("unsaved exit %i ms ago is %s", (age, level) => {
    expect(evaluateScheduleSave({ ...base, state: { lastUnsavedExitAt: before(age as number) } }).level).toBe(level);
  });

  it("a recent unsaved exit does not hide a critical failure", () => {
    expect(evaluateScheduleSave({ ...base, state: { lastCriticalAt: before(hour), lastUnsavedExitAt: before(1) } }).level).toBe("red");
  });
});
