// @vitest-environment jsdom
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

const region = vi.hoisted(() => ({ activeRegion: "A", selectedRegions: ["A"], toggleSelectedRegion: () => {} }));
vi.mock("@/lib/region-context", () => ({ useRegion: () => region }));
vi.mock("@/components/region-tabs", () => ({ RegionTabs: () => null }));
vi.mock("@/components/region-pills", () => ({ RegionPills: () => null }));
vi.mock("@/components/GoogleSheetsImportDialog", () => ({ GoogleSheetsImportDialog: () => null }));

import DashboardPage from "./dashboard";
import AvailabilityPage from "./availability";
import SchedulePage from "./schedule";
import WeeklyAttendancePage from "./weekly-attendance";
import { RadarClockIn } from "./portal";

const employee = {
  id: 7, name: "錯誤碼測試員", employeeCode: "TEST-7", role: "教練",
  regionId: 1, status: "active", employmentType: "part_time",
};
const originalGeolocation = navigator.geolocation;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubApi(failedPath: string, requestId: string, status = 503) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    const method = init?.method ?? "GET";
    if (path === failedPath && (method === "POST" || path.startsWith("/api/weekly-attendance/"))) {
      return jsonResponse({ message: `伺服器發生錯誤，請稍後再試（錯誤代碼 ${requestId}）`, requestId }, status);
    }
    if (method !== "GET") throw new Error(`Unexpected test request: ${method} ${path}`);
    if (path === "/api/regions") return jsonResponse([{ id: 1, code: "A", name: "測試區" }]);
    if (path.startsWith("/api/employees")) return jsonResponse([employee]);
    if (path.startsWith("/api/venues")) return jsonResponse([{ id: 1, regionId: 1, name: "測試場館", shortName: "測試場" }]);
    if (path.startsWith("/api/system-config/")) {
      return jsonResponse({ key: path.split("/").at(-1), value: null, updatedAt: null });
    }
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mount(page: ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {page}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function seedScheduleFixtures() {
  const start = "2026-11-01";
  const end = "2026-11-30";
  queryClient.setQueryData(["/api/employees", "A"], [employee]);
  queryClient.setQueryData(["/api/employees", "schedule", "A", start, end], [employee]);
  queryClient.setQueryData(["/api/employees-all"], [employee]);
  queryClient.setQueryData(["/api/regions"], [{ id: 1, code: "A", name: "測試區" }]);
  queryClient.setQueryData(["/api/venues", "A"], [{ id: 1, regionId: 1, name: "測試場館", shortName: "測試場" }]);
  queryClient.setQueryData(["/api/venues-all"], []);
  queryClient.setQueryData(["/api/schedule-slots", "A", start, end], []);
  queryClient.setQueryData(["/api/availabilities", "A", "2026-11"], []);
  queryClient.setQueryData(["/api/shifts", "A", start, end], []);
  queryClient.setQueryData(["/api/dispatch-shifts", "A", start, end], []);
  queryClient.setQueryData(["/api/system-config/date_annotations"], { key: "date_annotations", value: "[]", updatedAt: null });
}

async function saveAnnotation() {
  const date = "2026-11-11";
  fireEvent.click(await screen.findByTestId(`button-highlight-${date}`));
  fireEvent.click(await screen.findByTestId(`color-yellow-${date}`));
}

beforeEach(() => {
  queryClient.clear();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 11, 12));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  localStorage.clear();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: originalGeolocation });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("5xx error codes in existing error messages", () => {
  it.each([
    ["button-trigger-weekly-schedule", "/api/admin/trigger-weekly-schedule", "dashboard-schedule-503"],
    ["button-trigger-weekly-late-report", "/api/admin/trigger-weekly-late-report", "dashboard-late-503"],
  ])("dashboard %s keeps the push failure and displays its request id", async (button, path, requestId) => {
    const fetchMock = stubApi(path, requestId);
    mount(<DashboardPage />);
    fireEvent.click(await screen.findByTestId(button));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText(`推播失敗（錯誤代碼：${requestId}）`)).not.toBeNull();
  });

  it.each([
    ["button-save-window", "/api/system-config/availability_window", "availability-window-503"],
    ["button-save-holidays", "/api/system-config/monthly_holidays", "availability-holidays-503"],
  ])("availability %s keeps the save failure and displays its request id", async (button, path, requestId) => {
    const fetchMock = stubApi(path, requestId);
    mount(<AvailabilityPage />);
    fireEvent.click(await screen.findByTestId(button));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText(`儲存失敗（錯誤代碼：${requestId}）`)).not.toBeNull();
  });

  it("schedule annotation failure displays its request id", async () => {
    const fetchMock = stubApi("/api/system-config/date_annotations", "schedule-annotation-503");
    seedScheduleFixtures();
    mount(<SchedulePage />);
    await saveAnnotation();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/system-config/date_annotations", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("日期標註儲存失敗（錯誤代碼：schedule-annotation-503）")).not.toBeNull();
  });

  it("schedule template deletion materialize failure displays its request id", async () => {
    const fetchMock = stubApi("/api/schedule-slots/materialize", "schedule-materialize-503");
    seedScheduleFixtures();
    queryClient.setQueryData(["/api/schedule-slots", "A", "2026-11-01", "2026-11-30"], [{
      id: -1, venueId: 1, date: "2026-11-11", startTime: "09:00", endTime: "12:00",
      role: "教練", requiredCount: 1, _fromTemplate: true,
    }]);
    mount(<SchedulePage />);
    fireEvent.click(await screen.findByTestId("button-req-1-2026-11-11"));
    fireEvent.click(await screen.findByTestId("button-delete-req--1"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/schedule-slots/materialize", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        venueId: 1, date: "2026-11-11",
        excludeTemplateIds: [{ startTime: "09:00", endTime: "12:00", role: "教練" }],
      }),
    })));
    expect(await screen.findByText("操作失敗（錯誤代碼：schedule-materialize-503）")).not.toBeNull();
  });

  it("weekly attendance load failure displays its request id", async () => {
    stubApi("/api/weekly-attendance/2026-11-02", "weekly-attendance-503");
    mount(<WeeklyAttendancePage />);
    expect((await screen.findByTestId("text-error")).textContent).toContain("載入資料失敗（錯誤代碼：weekly-attendance-503）");
  });

  it("portal anomaly upload failure displays its request id with the existing guidance", async () => {
    const fetchMock = stubApi("/api/anomaly-report", "portal-anomaly-503");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, failure?: PositionErrorCallback) =>
          failure?.({ code: 3, message: "test location timeout" } as GeolocationPositionError),
      },
    });
    mount(<RadarClockIn employee={employee} />);
    fireEvent.click(await screen.findByTestId("button-clock-in"));
    fireEvent.click(await screen.findByTestId("button-anomaly-report"));
    fireEvent.change(screen.getByTestId("input-anomaly-note"), { target: { value: "測試異常說明" } });
    fireEvent.click(screen.getByTestId("button-submit-anomaly"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/anomaly-report", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("送出失敗（錯誤代碼：portal-anomaly-503）")).not.toBeNull();
    expect(screen.getByText("請稍後再試或手動截圖回報")).not.toBeNull();
  });
});

describe("existing error behavior", () => {
  it("dashboard keeps HTTP 400 failures unchanged even when the body has a request id", async () => {
    const fetchMock = stubApi("/api/admin/trigger-weekly-schedule", "dashboard-400", 400);
    mount(<DashboardPage />);
    fireEvent.click(await screen.findByTestId("button-trigger-weekly-schedule"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/trigger-weekly-schedule", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("推播失敗")).not.toBeNull();
    expect(screen.queryByText(/錯誤代碼：dashboard-400/)).toBeNull();
  });

  it("availability keeps the 409 conflict message and invalidates holidays", async () => {
    stubApi("/api/system-config/monthly_holidays", "not-a-5xx-code", 409);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    mount(<AvailabilityPage />);
    fireEvent.click(await screen.findByTestId("button-save-holidays"));
    expect(await screen.findByText("休館日已被其他人更新，已重新載入，請再操作一次")).not.toBeNull();
    expect(screen.queryByText(/錯誤代碼：not-a-5xx-code/)).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/system-config/monthly_holidays"] });
  });

  it("schedule keeps the 409 conflict message and invalidates annotations", async () => {
    stubApi("/api/system-config/date_annotations", "not-a-5xx-code", 409);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    seedScheduleFixtures();
    mount(<SchedulePage />);
    await saveAnnotation();
    expect(await screen.findByText("日期標註已被其他人更新，已重新載入，請再操作一次")).not.toBeNull();
    expect(screen.queryByText(/錯誤代碼：not-a-5xx-code/)).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/system-config/date_annotations"] });
  });

  it("dashboard keeps its existing fallback when the failure has no server code", async () => {
    const fetchMock = stubApi("unused", "unused");
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "POST") throw new Error("test connection lost");
      return jsonResponse([]);
    });
    mount(<DashboardPage />);
    fireEvent.click(await screen.findByTestId("button-trigger-weekly-schedule"));
    expect(await screen.findByText("推播失敗")).not.toBeNull();
  });
});
