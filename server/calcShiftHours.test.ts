/**
 * Regression test for the 2026-06 "equal start/end ≠ 24h" fix.
 *
 * A shift stored with start == end is a zero-length / unset entry and must count
 * as 0 hours — NOT a phantom 24-hour shift, which previously injected +24h and
 * instantly tripped the daily-12h / four-week-176h labour-law limits.
 */
import { describe, it, expect } from "vitest";
import { calcShiftHours } from "@shared/schema";

describe("calcShiftHours", () => {
  it("counts a normal day shift", () => {
    expect(calcShiftHours("08:00", "16:00")).toBe(8);
  });

  it("counts a genuine overnight shift (end strictly before start) as crossing midnight", () => {
    expect(calcShiftHours("22:00", "06:00")).toBe(8);
  });

  it("treats equal start/end as 0 hours, NOT 24", () => {
    expect(calcShiftHours("09:00", "09:00")).toBe(0);
    expect(calcShiftHours("00:00", "00:00")).toBe(0);
  });

  it("still treats an explicit 00:00→24:00 as a full 24h day", () => {
    expect(calcShiftHours("00:00", "24:00")).toBe(24);
  });
});
