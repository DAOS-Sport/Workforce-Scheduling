import { describe, expect, it } from "vitest";
import {
  classifyTiming,
  clockTypeForShift,
  coveredByApprovedOvertime,
  duplicateClock,
  isAccidentalRepeat,
  isInShiftWindow,
  lateDepartureReason,
  nearbyVenueList,
  nextClockType,
  pickVenue,
  rankVenues,
} from "./clockRules";

const venue = (id: number, lat: number, radius: number | null = 200) => ({ id, name: `場館${id}`, shortName: `館${id}`, latitude: lat, longitude: 121.5, radius });
const metersNorth = (m: number) => 25 + m / 111320;

describe("venue selection (GitHub #3)", () => {
  it("ranks by distance and skips venues without coordinates", () => {
    const ranked = rankVenues(25, 121.5, [venue(1, metersNorth(500)), venue(2, metersNorth(100)), { ...venue(3, 0), latitude: null }]);
    expect(ranked.map((r) => r.venue.id)).toEqual([2, 1]);
  });

  it("AC-3.1: accepts a farther venue whose own radius covers you", () => {
    const ranked = rankVenues(25, 121.5, [venue(1, metersNorth(100), 50), venue(2, metersNorth(150), 300)]);
    const picked = pickVenue(ranked)!;
    expect([picked.venue.id, picked.inRange, picked.radius]).toEqual([2, true, 300]);
    expect(nearbyVenueList(ranked).map((v) => [v.id, v.inRange])).toEqual([[1, false], [2, true]]);
  });

  it("AC-3.2: all out of range keeps the nearest as the reported venue; exact boundary is in range", () => {
    const out = pickVenue(rankVenues(25, 121.5, [venue(1, metersNorth(400), 100), venue(2, metersNorth(900), 300)]))!;
    expect([out.venue.id, out.inRange]).toEqual([1, false]);
    const boundary = pickVenue([{ venue: venue(1, 25), distance: 200 }])!;
    expect(boundary.inRange).toBe(true);
  });

  it("AC-3.2: several legal venues pick the nearest; equal distance picks the lower id", () => {
    const near = pickVenue([{ venue: venue(5, 25, 500), distance: 300 }, { venue: venue(3, 25, 500), distance: 120 }])!;
    expect(near.venue.id).toBe(3);
    const tie = pickVenue([{ venue: venue(9, 25, 500), distance: 100 }, { venue: venue(4, 25, 500), distance: 100 }])!;
    expect(tie.venue.id).toBe(4);
  });

  it("AC-3.3: a legal venue ranked sixth is still accepted", () => {
    const tight = [1, 2, 3, 4, 5].map((id) => ({ venue: venue(id, 25, 10), distance: 50 + id }));
    const picked = pickVenue([...tight, { venue: venue(6, 25, 1000), distance: 900 }])!;
    expect([picked.venue.id, picked.inRange]).toEqual([6, true]);
  });

  it("venues with a non-positive radius do not take part", () => {
    const picked = pickVenue([{ venue: venue(1, 25, -5), distance: 1 }, { venue: venue(2, 25, 300), distance: 250 }])!;
    expect(picked.venue.id).toBe(2);
  });

  it("missing radius defaults to 300 m", () => {
    const picked = pickVenue(rankVenues(25, 121.5, [venue(1, metersNorth(250), null)]))!;
    expect([picked.radius, picked.inRange]).toEqual([300, true]);
  });

  it("no venues with coordinates", () => {
    expect(pickVenue([])).toBeNull();
  });
});

describe("duplicate and accidental repeat", () => {
  const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 21, 2, 30) - minutesAgo * 60000);
  const now = Date.UTC(2026, 9, 21, 2, 30);

  it("blocks the same direction within 5 minutes and says how long to wait", () => {
    const d = duplicateClock({ clockType: "in", clockTime: at(2), status: "success" }, now, "in");
    expect(d).toEqual({ clockType: "in", failReason: "重複打卡：距上次上班打卡不足 5 分鐘（還需等待 3 分鐘）" });
  });

  it("allows switching direction, and anything after 5 minutes", () => {
    expect(duplicateClock({ clockType: "in", clockTime: at(2), status: "success" }, now)).toBeNull();
    expect(duplicateClock({ clockType: "in", clockTime: at(5), status: "success" }, now, "in")).toBeNull();
    expect(duplicateClock(null, now, "in")).toBeNull();
  });

  it("accidental repeat: within 2 minutes after clocking in, only without a forced direction", () => {
    const last = { clockType: "in", clockTime: at(1), status: "success" };
    expect(isAccidentalRepeat(last, now)).toBe(true);
    expect(isAccidentalRepeat(last, now, "out")).toBe(false);
    expect(isAccidentalRepeat({ ...last, clockTime: at(2) }, now)).toBe(false);
    expect(isAccidentalRepeat({ ...last, clockType: "out" }, now)).toBe(false);
  });
});

describe("direction", () => {
  it("next direction follows the latest successful record", () => {
    expect(nextClockType([])).toBe("in");
    expect(nextClockType([{ clockType: "in", clockTime: "2026-10-21T01:00:00Z", status: "success" }, { clockType: "out", clockTime: "2026-10-21T02:00:00Z", status: "fail" }])).toBe("out");
  });

  it("once a shift has a clock-in, every later punch on it is a clock-out", () => {
    const records = [{ clockType: "in", clockTime: "x", status: "success", shiftId: 7 }];
    expect(clockTypeForShift(records, 7)).toBe("out");
    expect(clockTypeForShift(records, 8)).toBe("in");
    expect(clockTypeForShift(records, 7, "in")).toBe("in");
  });

  it("shift window includes a 30 minute buffer on both sides", () => {
    const shift = { startTime: "08:00:00", endTime: "16:00:00" };
    expect([isInShiftWindow(7 * 60 + 30, shift), isInShiftWindow(7 * 60 + 29, shift), isInShiftWindow(16 * 60 + 30, shift), isInShiftWindow(16 * 60 + 31, shift)]).toEqual([true, false, true, false]);
  });
});

describe("timing", () => {
  const shift = { startTime: "08:00:00", endTime: "16:00:00" };
  it("late only after the 10 minute grace", () => {
    expect(classifyTiming("in", 8 * 60 + 10, shift)).toEqual({ kind: "on_time" });
    expect(classifyTiming("in", 8 * 60 + 11, shift)).toEqual({ kind: "late", reason: "遲到 11 分鐘" });
    expect(classifyTiming("in", 10 * 60 + 30, shift)).toEqual({ kind: "late", reason: "遲到 2 小時 30 分鐘" });
  });
  it("early arrival from 15 minutes before", () => {
    expect(classifyTiming("in", 7 * 60 + 46, shift)).toEqual({ kind: "on_time" });
    expect(classifyTiming("in", 7 * 60 + 45, shift)).toEqual({ kind: "early_arrival", minutes: 15, reason: "提早 15 分鐘到" });
  });
  it("early leave after the grace, after-shift from 15 minutes later", () => {
    expect(classifyTiming("out", 15 * 60 + 49, shift)).toEqual({ kind: "early_leave", reason: "早退 11 分鐘" });
    expect(classifyTiming("out", 15 * 60 + 50, shift)).toEqual({ kind: "on_time" });
    expect(classifyTiming("out", 16 * 60 + 15, shift)).toEqual({ kind: "after_shift", minutes: 15 });
    expect(lateDepartureReason(75)).toBe("晚下班 1 小時 15 分鐘");
  });
  it("approved overtime covers until 15 minutes after it ends", () => {
    const ot = [{ status: "approved", startTime: "16:00", endTime: "18:00" }, { status: "pending", startTime: "18:00", endTime: "20:00" }];
    expect([coveredByApprovedOvertime(18 * 60 + 15, ot), coveredByApprovedOvertime(18 * 60 + 16, ot), coveredByApprovedOvertime(19 * 60, ot)]).toEqual([true, false, false]);
  });
});
