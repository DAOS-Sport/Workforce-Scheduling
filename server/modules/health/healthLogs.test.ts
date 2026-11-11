import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../infra/db", () => ({ db: { execute } }));

import { attachPipelineLogs, parseHealthLogsOptions, queryHealthLogs } from "./healthLogs";

beforeEach(() => vi.clearAllMocks());

describe("health log filters", () => {
  it("defaults to info and 50, accepts future pipeline ids and valid microsecond dates", () => {
    expect(parseHealthLogsOptions({})).toEqual({ level: "info", limit: 50 });
    expect(parseHealthLogsOptions({ pipeline: "future.new.job", since: "2026-11-01T03:12:01.123456Z", limit: "2", level: "warn" }))
      .toEqual({ pipeline: "future.new.job", since: "2026-11-01T03:12:01.123456Z", limit: 2, level: "warn" });
  });

  it("rejects impossible dates, loose limits and malformed cursors", () => {
    for (const input of [{ since: "2026-02-29T00:00:00Z" }, { since: "2026-13-01T00:00:00Z" }, { since: "2026-01-01T24:00:00Z" }, { limit: "+2" }, { limit: "01" }, { pipeline: ["a", "b"] }, { cursor: "e30" }]) {
      expect(() => parseHealthLogsOptions(input)).toThrow();
    }
    expect(() => parseHealthLogsOptions({ since: "2024-02-29T00:00:00Z" })).not.toThrow();
  });
});

describe("health log pages", () => {
  const row = (id: number, at = "2026-11-11T00:00:00.123456Z") => ({ id, at, level: "warn", pipeline: "future.job", requestId: null, message: `warning ${id}` });
  it("returns at most limit rows and a cursor that preserves microseconds and the tied id", async () => {
    execute.mockResolvedValue({ rows: [row(3), row(2), row(1)] });
    const page = await queryHealthLogs({ limit: 2 });
    expect(page.logs.map((entry) => entry.id)).toEqual([3, 2]);
    expect(JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString())).toEqual({ at: "2026-11-11T00:00:00.123456Z", id: 2 });
    expect(parseHealthLogsOptions({ cursor: page.nextCursor! }).cursor).toBe(page.nextCursor);
  });

  it("does not offer another page when exactly limit rows remain", async () => {
    execute.mockResolvedValue({ rows: [row(1)] });
    expect((await queryHealthLogs({ limit: 1 })).nextCursor).toBeNull();
  });
});

describe("pipeline report logs", () => {
  it("attaches each pipeline's newest warnings without changing its health", async () => {
    const log = { id: 1, at: "2026-11-11T00:00:00.000000Z", level: "error", pipeline: "future.job", requestId: "req-1", message: "failed" };
    execute.mockResolvedValue({ rows: [log] });
    const report = { pipelines: [{ id: "future.job", level: "red" }, { id: "database", level: "green" }] };
    const attached = await attachPipelineLogs(report, new Date("2026-11-11T12:00:00Z"));
    expect(attached.pipelines[0]).toEqual({ ...report.pipelines[0], logs: [log] });
    expect(attached.pipelines[1]).toEqual({ ...report.pipelines[1], logs: [] });
  });

  it("marks unavailable logs explicitly without leaking a connection error or rejecting the report", async () => {
    execute.mockRejectedValue(new Error("password=secret host=private"));
    const result = await attachPipelineLogs({ pipelines: [{ id: "database", level: "green" }] }, new Date());
    expect(result.pipelines[0]).toEqual({ id: "database", level: "green", logs: [], logsError: "無法讀取日誌" });
  });
});
