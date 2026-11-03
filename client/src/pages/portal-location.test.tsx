// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryClient } from "@/lib/queryClient";
import { UA_IPHONE_LINE, UA_IPHONE_SAFARI, UA_DESKTOP_CHROME } from "@/lib/__fixtures__/user-agents";
import PortalPage, { RadarClockIn } from "./portal";

const EMPLOYEE = { id: 7, name: "測試員工", employeeCode: "7001", role: "教練" };

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: ua });
}

function stubGeolocationError(code: number) {
  const getCurrentPosition = vi.fn((_ok: PositionCallback, fail?: PositionErrorCallback) => {
    fail?.({ code, message: "error" } as GeolocationPositionError);
  });
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PortalPage 入口", () => {
  it.each([
    ["iPhone Safari", UA_IPHONE_SAFARI],
    ["桌機 Chrome", UA_DESKTOP_CHROME],
  ])("正式環境、非 LINE 瀏覽器（%s）：不擋人，顯示 LINE 登入按鈕", async (_name, ua) => {
    vi.stubEnv("DEV", false);
    setUserAgent(ua);
    render(
      <QueryClientProvider client={queryClient}>
        <PortalPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("button-line-login")).toBeTruthy();
    expect(screen.queryByText("請使用 LINE 開啟")).toBeNull();
  });

  it("網址帶 ?lineId= 不會用它登入：停在 LINE 登入按鈕，不呼叫 /api/portal/verify", async () => {
    vi.stubEnv("DEV", false);
    setUserAgent(UA_IPHONE_SAFARI);
    window.history.pushState({}, "", "/portal?lineId=U0123456789abcdef0123456789abcdef");
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <PortalPage />
        </QueryClientProvider>,
      );

      expect(await screen.findByTestId("button-line-login")).toBeTruthy();
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(calls.filter((u) => u.includes("/api/portal/verify"))).toEqual([]);
    } finally {
      window.history.pushState({}, "", "/");
    }
  });
});

describe("RadarClockIn 定位被拒", () => {
  async function clockInWithGeoError(code: number) {
    setUserAgent(UA_IPHONE_LINE);
    stubGeolocationError(code);
    render(
      <QueryClientProvider client={queryClient}>
        <RadarClockIn employee={EMPLOYEE} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByTestId("button-clock-in"));
  }

  it("code 1：顯示位置權限被拒絕，並附上定位權限說明與改用瀏覽器按鈕", async () => {
    await clockInWithGeoError(1);

    expect(await screen.findByText("位置存取權限被拒絕")).toBeTruthy();
    expect(screen.getByTestId("location-permission-help")).toBeTruthy();
    expect(screen.getByTestId("button-open-external-browser")).toBeTruthy();
    expect(screen.getByTestId("button-retry-clock")).toBeTruthy();
  });

  it("code 3：只顯示逾時訊息，沒有定位權限說明", async () => {
    await clockInWithGeoError(3);

    expect(await screen.findByText("定位逾時，請到空曠處再試")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("button-retry-clock")).toBeTruthy());
    expect(screen.queryByTestId("location-permission-help")).toBeNull();
  });
});
