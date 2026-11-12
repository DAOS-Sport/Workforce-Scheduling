// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HealthMonitor } from "@/components/health-monitor";
import type { HealthReport, Pipeline } from "@/lib/health-view";
import ItMonitorPage from "./it-monitor";

const NOW = new Date("2026-11-03T04:00:00.000Z");

const pipe = (id: string, level: Pipeline["level"], extra: Partial<Pipeline> = {}): Pipeline => ({
  id,
  name: `名稱-${id}`,
  level,
  reason: `理由-${id}`,
  lastSuccessAt: null,
  lastFailureAt: null,
  source: null,
  ...extra,
});

const reportOf = (pipelines: Pipeline[]): HealthReport => ({
  system: "workforce-scheduling",
  build: "abc1234",
  checkedAt: "2026-11-03T03:59:00.000Z",
  overall: "green",
  pipelines,
});

function view(pipelines: Pipeline[], props: Partial<React.ComponentProps<typeof HealthMonitor>> = {}) {
  return render(
    <HealthMonitor report={reportOf(pipelines)} error={null} fetchedAt="2026-11-03T03:59:30.000Z" failedAt={null} now={NOW} {...props} />,
  );
}

const level = (id: string) => screen.getByTestId(`light-${id}`).getAttribute("data-level");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HealthMonitor lights", () => {
  it("shows green, yellow and red for the matching inputs, each with its own last-success time", () => {
    view([
      pipe("database", "green", { lastSuccessAt: "2026-11-03T03:30:00.000Z" }),
      pipe("integration.line", "yellow", { lastSuccessAt: "2026-11-03T02:00:00.000Z", lastFailureAt: "2026-11-03T03:00:00.000Z" }),
      pipe("integration.ragic", "red", { lastSuccessAt: "2026-11-02T00:00:00.000Z", lastFailureAt: "2026-11-03T03:50:00.000Z" }),
    ]);

    expect(level("database")).toBe("green");
    expect(level("integration.line")).toBe("yellow");
    expect(level("integration.ragic")).toBe("red");
    expect(within(screen.getByTestId("light-database")).getByText("正常")).toBeTruthy();
    expect(within(screen.getByTestId("light-integration.line")).getByText("注意")).toBeTruthy();
    expect(within(screen.getByTestId("light-integration.ragic")).getByText("異常")).toBeTruthy();
    const dot = (id: string) => screen.getByTestId(`light-${id}`).querySelector("span[aria-hidden]")!.className;
    expect(dot("database")).toContain("bg-green-500");
    expect(dot("integration.line")).toContain("bg-amber-500");
    expect(dot("integration.ragic")).toContain("bg-red-500");

    expect(screen.getByTestId("last-success-database").textContent).toContain("2026-11-03 11:30");
    expect(screen.getByTestId("last-success-database").textContent).toContain("30 分鐘前");
    expect(screen.getByTestId("last-success-integration.line").textContent).toContain("2026-11-03 10:00");
    expect(screen.getByTestId("last-success-integration.ragic").textContent).toContain("2026-11-02 08:00");
    expect(screen.getByTestId("last-failure-integration.ragic").textContent).toContain("2026-11-03 11:50");
    expect(screen.getByTestId("reason-integration.ragic").textContent).toBe("理由-integration.ragic");
  });

  it("the overall light is the worst of the rows and the counts add up", () => {
    view([pipe("database", "green"), pipe("integration.line", "yellow"), pipe("integration.mail", "red"), pipe("push.a", "red")]);
    expect(level("overall")).toBe("red");
    expect(screen.getByTestId("text-health-counts").textContent).toBe("異常 2・注意 1・正常 2");
  });

  it("shows a dash when a pipeline has never succeeded and no failure line when it never failed", () => {
    view([pipe("database", "yellow")]);
    expect(screen.getByTestId("last-success-database").textContent).toContain("—");
    expect(screen.queryByTestId("last-failure-database")).toBeNull();
    expect(screen.queryByTestId("recovered-database")).toBeNull();
  });
});

describe("HealthMonitor recovery", () => {
  it("a dependency that failed and then succeeded is green and shows when it came back", () => {
    view([
      pipe("integration.line", "green", { lastFailureAt: "2026-11-03T01:00:00.000Z", recoveredAt: "2026-11-03T01:20:00.000Z", lastSuccessAt: "2026-11-03T03:00:00.000Z" }),
      pipe("integration.mail", "red", { lastSuccessAt: "2026-11-03T01:00:00.000Z", lastFailureAt: "2026-11-03T01:20:00.000Z" }),
    ]);
    expect(level("integration.line")).toBe("green");
    expect(screen.getByTestId("last-failure-integration.line").textContent).toContain("2026-11-03 09:00");
    expect(screen.getByTestId("recovered-integration.line").textContent).toContain("2026-11-03 09:20");
    expect(screen.getByTestId("last-success-integration.line").textContent).toContain("2026-11-03 11:00");
    expect(screen.queryByTestId("recovered-integration.mail")).toBeNull();
  });
});

describe("HealthMonitor layout", () => {
  it("groups rows under app (with the API row), database, external dependencies and jobs", () => {
    view([pipe("push.a", "green"), pipe("integration.line", "green"), pipe("database", "green"), pipe("clock.coverage", "green")]);
    const inGroup = (key: string) => within(screen.getByTestId(`group-${key}`));
    expect(inGroup("app").getByTestId("pipeline-api")).toBeTruthy();
    expect(inGroup("app").getByTestId("pipeline-clock.coverage")).toBeTruthy();
    expect(inGroup("database").getByTestId("pipeline-database")).toBeTruthy();
    expect(inGroup("external").getByTestId("pipeline-integration.line")).toBeTruthy();
    expect(inGroup("jobs").getByTestId("pipeline-push.a")).toBeTruthy();
    expect(screen.getByTestId("pipeline-clock.coverage").id).toBe("clock.coverage");
  });

  it("long text can wrap instead of widening the page", () => {
    view([pipe("integration.line", "red", { reason: "x".repeat(300) })]);
    const row = screen.getByTestId("pipeline-integration.line");
    expect(row.className).toContain("min-w-0");
    expect(screen.getByTestId("reason-integration.line").className).toContain("break-words");
  });
});

describe("HealthMonitor request ID slot", () => {
  it("shows the request ID handed in for a pipeline and nothing for the others", () => {
    view([pipe("integration.line", "red"), pipe("integration.mail", "red")], { errorRefs: { "integration.line": { requestId: "req-0001" } } });
    expect(screen.getByTestId("request-id-integration.line").textContent).toContain("req-0001");
    expect(screen.queryByTestId("request-id-integration.mail")).toBeNull();
  });
});

describe("HealthMonitor API row", () => {
  it("is red with the error when fetching failed, and the rest of the last report stays visible", () => {
    view([pipe("database", "green")], { error: "500: 無法產生健康報告", failedAt: "2026-11-03T03:59:50.000Z" });
    expect(level("api")).toBe("red");
    expect(screen.getByTestId("reason-api").textContent).toContain("500: 無法產生健康報告");
    expect(level("overall")).toBe("red");
    expect(level("database")).toBe("green");
  });

  it("is green when the report arrived", () => {
    view([pipe("database", "green")]);
    expect(level("api")).toBe("green");
    expect(level("overall")).toBe("green");
  });
});

describe("ItMonitorPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    window.history.replaceState({}, "", "/it-monitor");
  });

  function mount(respond: () => Promise<unknown>) {
    const calls: string[] = [];
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: async ({ queryKey }) => {
            calls.push(queryKey.join("/"));
            return respond();
          },
        },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <ItMonitorPage />
      </QueryClientProvider>,
    );
    return calls;
  }

  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(10); });

  it("reads /api/admin/health and renders the lights", async () => {
    const calls = mount(async () => reportOf([pipe("database", "red", { reason: "連不上資料庫" })]));
    await flush();
    expect(calls).toEqual(["/api/admin/health"]);
    expect(level("database")).toBe("red");
    expect(level("api")).toBe("green");
  });

  it("scrolls to a pipeline when the hash changes after the report loads", async () => {
    const scrollIntoView = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      mount(async () => reportOf([pipe("clock.amendment", "red"), pipe("push.daily", "green")]));
      await flush();
      expect(scrollIntoView).not.toHaveBeenCalled();

      await act(async () => {
        window.location.hash = "clock.amendment";
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId("pipeline-clock.amendment"));

      await act(async () => {
        window.location.hash = "push.daily";
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView.mock.contexts[1]).toBe(screen.getByTestId("pipeline-push.daily"));

      await act(async () => {
        window.location.hash = "unknown.pipeline";
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    } finally {
      if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("renders embedded pipeline logs from the report without another request", async () => {
    const calls = mount(async () => reportOf([pipe("future.job", "red", {
      logs: [{ id: 1, at: "2026-11-03T03:00:00.000000Z", level: "error", pipeline: "future.job", requestId: "req-page", message: "管線錯誤內容" }],
    })]));
    await flush();
    expect(screen.getByText("管線錯誤內容")).toBeTruthy();
    expect(screen.getByText("req-page")).toBeTruthy();
    expect(calls).toEqual(["/api/admin/health"]);
  });

  it("asks again every 60 seconds and shows the newer report", async () => {
    let current = reportOf([pipe("database", "red", { reason: "連不上資料庫" })]);
    const calls = mount(async () => current);
    await flush();
    expect(calls).toHaveLength(1);
    expect(level("database")).toBe("red");

    current = reportOf([pipe("database", "green", { reason: "查詢正常", lastFailureAt: "2026-11-03T03:58:00.000Z", recoveredAt: "2026-11-03T04:00:30.000Z", lastSuccessAt: "2026-11-03T04:00:30.000Z" })]);
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(calls).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await flush();
    expect(calls).toHaveLength(2);
    expect(level("database")).toBe("green");
    expect(screen.getByTestId("recovered-database")).toBeTruthy();
  });

  it("turns the API light red when the request fails and green again when it recovers", async () => {
    let fail = true;
    mount(async () => {
      if (fail) throw new Error("503: down");
      return reportOf([pipe("database", "green")]);
    });
    await flush();
    expect(level("api")).toBe("red");
    expect(screen.getByTestId("reason-api").textContent).toContain("503: down");

    fail = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flush();
    expect(level("api")).toBe("green");
    expect(screen.getByTestId("last-failure-api")).toBeTruthy();
    const recoveredStamp = () => screen.getByTestId("recovered-api").querySelector("time")!.getAttribute("datetime");
    const firstStamp = recoveredStamp();
    expect(firstStamp).toBe("2026-11-03T04:01:00.000Z");

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await flush();
    expect(recoveredStamp()).toBe(firstStamp);
    expect(screen.getByTestId("last-success-api").textContent).toContain("2026-11-03 12:02");
  });
});
