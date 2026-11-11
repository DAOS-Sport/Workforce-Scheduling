import { describe, expect, it } from "vitest";
import { evaluateClockNeverSuccess } from "./rules";

describe("evaluateClockNeverSuccess", () => {
  const base = {
    id: "synthetic.clock-never-success",
    name: "虛構管線名稱",
    source: "synthetic-health-source",
  };

  it.each([
    { name: "green when nobody qualifies", affected: 0, newly: 0, level: "green", counts: [] },
    { name: "yellow while only previously qualified employees remain", affected: 3, newly: 0, level: "yellow", counts: [3] },
    { name: "red when an employee first qualifies", affected: 1, newly: 1, level: "red", counts: [1] },
    { name: "red when newly and previously qualified employees coexist", affected: 5, newly: 2, level: "red", counts: [5, 2] },
  ])("$name", ({ affected, newly, level, counts }) => {
    const result = evaluateClockNeverSuccess({
      ...base,
      signals: { affectedEmployees: affected, newlyQualifiedEmployees: newly },
    });

    expect(result.level).toBe(level);
    for (const count of counts) expect(result.reason).toMatch(new RegExp(`\\b${count}\\b`));
    expect(result.reason).not.toContain(base.id);
    expect(result.reason).not.toContain(base.name);
  });
});
