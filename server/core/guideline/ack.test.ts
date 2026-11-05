import { describe, expect, it } from "vitest";
import { ackIsCurrent } from "./ack";

const at = (iso: string) => new Date(iso);

describe("ackIsCurrent", () => {
  it("counts an acknowledgment from this month of a guideline not edited since", () => {
    expect(ackIsCurrent(at("2026-11-03T02:00:00Z"), at("2026-10-20T02:00:00Z"), at("2026-11-20T02:00:00Z"))).toBe(true);
  });

  it("does not count one from an earlier month", () => {
    expect(ackIsCurrent(at("2026-10-31T02:00:00Z"), null, at("2026-11-03T02:00:00Z"))).toBe(false);
  });

  it("does not count one given before the guideline was edited", () => {
    expect(ackIsCurrent(at("2026-11-03T02:00:00Z"), at("2026-11-04T02:00:00Z"), at("2026-11-05T02:00:00Z"))).toBe(false);
  });

  it("reads the month in Taipei time: 16:30 UTC on the last day is already the next month there", () => {
    expect(ackIsCurrent(at("2026-10-31T16:30:00Z"), null, at("2026-11-02T02:00:00Z"))).toBe(true);
  });

  it("does not count an acknowledgment without a time", () => {
    expect(ackIsCurrent(null, null, at("2026-11-03T02:00:00Z"))).toBe(false);
  });
});
