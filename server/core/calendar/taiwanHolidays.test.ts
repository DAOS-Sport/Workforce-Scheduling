import { describe, expect, it } from "vitest";
import { TAIWAN_HOLIDAYS, lastHolidayDate } from "./taiwanHolidays";

describe("Taiwan holiday table", () => {
  it("covers through the end of 2027", () => {
    expect(lastHolidayDate()).toBe("2027-12-31");
  });

  it("includes the holidays added by the 2025 amendment for late 2026 and 2027", () => {
    expect([TAIWAN_HOLIDAYS["2026-10-26"], TAIWAN_HOLIDAYS["2026-12-25"], TAIWAN_HOLIDAYS["2027-09-28"], TAIWAN_HOLIDAYS["2027-10-25"]]).toEqual([
      "補假",
      "行憲紀念日",
      "孔子誕辰紀念日/教師節",
      "臺灣光復暨金門古寧頭大捷紀念日",
    ]);
  });

  it("every key is a real calendar date in ascending order", () => {
    const keys = Object.keys(TAIWAN_HOLIDAYS);
    for (const k of keys) expect(new Date(`${k}T00:00:00Z`).toISOString().slice(0, 10)).toBe(k);
    expect([...keys].sort()).toEqual(keys);
  });
});
