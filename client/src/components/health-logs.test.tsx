// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HealthLogs } from "./health-logs";
import type { HealthReport } from "@/lib/health-view";

const log = (id: number, message = `日誌 ${id}`) => ({ id, at: "2026-11-11T03:00:00.000000Z", level: "warn" as const, pipeline: "future.job", requestId: "req-123", message });
const report = {
  system: "workforce-scheduling", build: "test", checkedAt: "2026-11-11T04:00:00Z", overall: "green",
  pipelines: [{ id: "future.job", name: "未來管線", level: "red", reason: "failed", lastSuccessAt: null, lastFailureAt: null, source: null, logs: [log(2)] }],
} as HealthReport;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("HealthLogs", () => {
  it("shows report warnings, pipeline, request ID and escaped message without making another request", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<HealthLogs report={{ ...report, pipelines: [{ ...report.pipelines[0], logs: [log(2, "<script>alert('x')</script>")] }] }} />);
    expect(screen.getByText("<script>alert('x')</script>")).toBeTruthy();
    expect(screen.getByText("req-123")).toBeTruthy();
    expect(screen.getByRole("option", { name: "未來管線" })).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("queries the admin endpoint with filters and follows its cursor without a health token", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ logs: [log(3)], nextCursor: "cursor-next" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ logs: [log(1)], nextCursor: null })));
    vi.stubGlobal("fetch", fetcher);
    render(<HealthLogs report={report} />);
    fireEvent.change(screen.getByLabelText("管線"), { target: { value: "future.job" } });
    fireEvent.change(screen.getByLabelText("等級"), { target: { value: "error" } });
    fireEvent.change(screen.getByLabelText("起始時間（本機時間）"), { target: { value: "2026-11-10T12:30" } });
    fireEvent.click(screen.getByRole("button", { name: "查詢日誌" }));
    await screen.findByText("日誌 3");
    const [path, init] = fetcher.mock.calls[0];
    const url = new URL(path, "http://localhost");
    expect(url.pathname).toBe("/api/admin/health/logs");
    expect(Object.fromEntries(url.searchParams)).toEqual({ pipeline: "future.job", level: "error", since: new Date("2026-11-10T12:30").toISOString(), limit: "50" });
    expect(init).toEqual({ credentials: "same-origin" });
    expect(screen.queryByText("日誌 2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));
    await screen.findByText("日誌 1");
    expect(screen.getByText("日誌 3")).toBeTruthy();
    expect(new URL(fetcher.mock.calls[1][0], "http://localhost").searchParams.get("cursor")).toBe("cursor-next");
    expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull();
  });

  it("distinguishes unavailable report logs and failed queries from an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private database detail", { status: 500 })));
    render(<HealthLogs report={{ ...report, pipelines: [{ ...report.pipelines[0], logs: [], logsError: "無法讀取日誌" }] }} />);
    expect(screen.getByText("未來管線：無法讀取日誌")).toBeTruthy();
    expect(screen.queryByText("沒有符合條件的日誌")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查詢日誌" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("無法讀取日誌，請稍後再試"));
    expect(screen.queryByText("private database detail")).toBeNull();
  });
});
