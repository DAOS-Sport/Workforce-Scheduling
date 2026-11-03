import { describe, expect, it } from "vitest";
import { taipeiInstant } from "../time/taipei";
import { overtimeAfterShift } from "./clockOutOvertime";

const at = (date: string, hhmm: string) => taipeiInstant(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));
const dayShift = { date: "2026-07-06", startTime: "09:00:00", endTime: "18:00:00" };

describe("overtime from a late clock-out", () => {
  it("runs from the shift end to the clock-out on the same day", () => {
    expect(overtimeAfterShift(dayShift, at("2026-07-06", "19:30"))).toEqual({ startTime: "18:00:00", endTime: "19:30" });
  });

  it("is nothing for a clock-out at or before the shift end", () => {
    expect(overtimeAfterShift(dayShift, at("2026-07-06", "18:00"))).toBeNull();
    expect(overtimeAfterShift(dayShift, at("2026-07-06", "17:30"))).toBeNull();
  });

  it("counts a clock-out after midnight against the shift of the day before", () => {
    const evening = { date: "2026-07-06", startTime: "16:00", endTime: "23:00" };
    expect(overtimeAfterShift(evening, at("2026-07-07", "00:40"))).toEqual({ startTime: "23:00", endTime: "00:40" });
  });

  it("treats an end at or before the start as the next day", () => {
    const overnight = { date: "2026-07-06", startTime: "18:00", endTime: "01:00" };
    expect(overtimeAfterShift(overnight, at("2026-07-06", "19:00"))).toBeNull();
    expect(overtimeAfterShift(overnight, at("2026-07-07", "00:30"))).toBeNull();
    expect(overtimeAfterShift(overnight, at("2026-07-07", "02:00"))).toEqual({ startTime: "01:00", endTime: "02:00" });
    const toMidnight = { date: "2026-07-06", startTime: "16:00", endTime: "00:00" };
    expect(overtimeAfterShift(toMidnight, at("2026-07-06", "23:50"))).toBeNull();
  });

  it("ignores a clock-out dated before the shift or two days after it", () => {
    expect(overtimeAfterShift(dayShift, at("2026-07-05", "19:00"))).toBeNull();
    expect(overtimeAfterShift(dayShift, at("2026-07-08", "19:00"))).toBeNull();
  });
});
