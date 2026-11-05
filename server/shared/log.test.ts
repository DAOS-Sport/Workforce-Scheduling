import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTimestamp, installLogStamp, log, maskId } from "./log";
import { runWithRequestId } from "./http/requestId";

describe("maskId (GitHub #5)", () => {
  it("keeps only the ends of a LINE ID", () => {
    expect(maskId("U1234567890abcdef1234567890abcdef")).toBe("U12…cdef");
    expect(maskId("short")).toBe("***");
    expect(maskId(null)).toBe("none");
  });
});

describe("log lines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("write the full date and the time zone offset, in Taipei time whatever the server's zone", () => {
    expect(formatTimestamp(new Date("2026-11-03T16:30:15.123Z"))).toBe("2026-11-04T00:30:15.123+08:00");
    expect(formatTimestamp(new Date("2026-12-31T23:59:59.000Z"))).toBe("2027-01-01T07:59:59.000+08:00");
  });

  it("carry the request id of the request being served, and a dash outside one", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));

    log("boot", "startup");
    runWithRequestId("req-abc_123", () => log("GET /api/x 200 in 5ms"));

    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00 \[startup\] \[-\] boot$/);
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00 \[express\] \[req-abc_123\] GET \/api\/x 200 in 5ms$/);
  });
});

describe("installLogStamp", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives bare console lines the same time and request id prefix, and leaves log() lines alone", () => {
    const seen: unknown[][] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void seen.push(args));
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void seen.push(args));
    const uninstall = installLogStamp();
    try {
      runWithRequestId("req-xyz", () => {
        console.log("[Clock-in] User: emp#7");
        console.warn("[health] could not write", { key: "k" });
        log("already stamped", "express");
      });
      console.log("outside a request");
    } finally {
      uninstall();
    }

    const withoutTime = (value: unknown) => String(value).replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00 /, "");
    expect(withoutTime(seen[0][0])).toBe("[console] [req-xyz]");
    expect(seen[0].slice(1)).toEqual(["[Clock-in] User: emp#7"]);
    expect(withoutTime(seen[1][0])).toBe("[console] [req-xyz]");
    expect(seen[1].slice(1)).toEqual(["[health] could not write", { key: "k" }]);
    expect(seen[2]).toHaveLength(1);
    expect(withoutTime(seen[2][0])).toBe("[express] [req-xyz] already stamped");
    expect(withoutTime(seen[3][0])).toBe("[console] [-]");
    expect(String(seen[3][0])).not.toBe(withoutTime(seen[3][0]));
  });
});
