// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { LocationPermissionHelp } from "./location-permission-help";
import {
  UA_IPHONE_LINE,
  UA_ANDROID_LINE,
  UA_IPHONE_SAFARI,
  UA_ANDROID_CHROME,
  UA_DESKTOP_CHROME,
} from "@/lib/__fixtures__/user-agents";

const liffMock = vi.hoisted(() => ({
  id: "" as string,
  init: vi.fn(),
  isInClient: vi.fn(),
  openWindow: vi.fn(),
}));

vi.mock("@line/liff", () => ({ default: liffMock }));

const ORIGIN = "https://app.example.com";

const originalLocation = window.location;

function stubLocation() {
  const stub = { href: `${ORIGIN}/portal`, origin: ORIGIN } as unknown as Location;
  Object.defineProperty(window, "location", { configurable: true, value: stub });
  return stub;
}

beforeEach(() => {
  liffMock.id = "";
  liffMock.init.mockReset().mockResolvedValue(undefined);
  liffMock.isInClient.mockReset().mockReturnValue(false);
  liffMock.openWindow.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  vi.unstubAllGlobals();
});

describe("LocationPermissionHelp", () => {
  it("iPhone LINE：顯示 iOS 設定步驟與改用瀏覽器按鈕，非 LIFF 時按下後導向 openExternalBrowser=1", async () => {
    const loc = stubLocation();
    render(<LocationPermissionHelp ua={UA_IPHONE_LINE} origin={ORIGIN} />);

    expect(screen.getByText("LINE 沒有取得定位權限")).toBeTruthy();
    expect(screen.getByText(/隱私權與安全性/)).toBeTruthy();
    expect(screen.getByText(/選「使用 App 期間」，並打開「精確位置」/)).toBeTruthy();
    expect(screen.getByText("不需要清除 LINE 的快取或資料。")).toBeTruthy();
    expect(screen.getByText("開啟後用 LINE 登入即可打卡")).toBeTruthy();
    expect(screen.getByText(`${ORIGIN}/portal`)).toBeTruthy();

    fireEvent.click(screen.getByTestId("button-open-external-browser"));
    await waitFor(() => expect(loc.href).toBe(`${ORIGIN}/portal?openExternalBrowser=1`));
    expect(liffMock.openWindow).not.toHaveBeenCalled();
  });

  it("LIFF 內（isInClient）：用 liff.openWindow external，網址不帶 openExternalBrowser", async () => {
    const loc = stubLocation();
    liffMock.id = "1234-abcd";
    liffMock.isInClient.mockReturnValue(true);
    render(<LocationPermissionHelp ua={UA_IPHONE_LINE} origin={ORIGIN} />);

    fireEvent.click(screen.getByTestId("button-open-external-browser"));
    await waitFor(() => expect(liffMock.openWindow).toHaveBeenCalledTimes(1));
    expect(liffMock.openWindow).toHaveBeenCalledWith({ url: `${ORIGIN}/portal`, external: true });
    expect(loc.href).toBe(`${ORIGIN}/portal`);
  });

  it("LIFF 尚未 init 且有 VITE_LIFF_ID：先 init 再判斷 isInClient", async () => {
    stubLocation();
    vi.stubEnv("VITE_LIFF_ID", "1234-abcd");
    liffMock.isInClient.mockReturnValue(true);
    render(<LocationPermissionHelp ua={UA_IPHONE_LINE} origin={ORIGIN} />);

    fireEvent.click(screen.getByTestId("button-open-external-browser"));
    await waitFor(() => expect(liffMock.openWindow).toHaveBeenCalledTimes(1));
    expect(liffMock.init).toHaveBeenCalledWith({ liffId: "1234-abcd" });
  });

  it("liff.init 丟錯：退回 openExternalBrowser=1", async () => {
    const loc = stubLocation();
    vi.stubEnv("VITE_LIFF_ID", "1234-abcd");
    liffMock.init.mockRejectedValue(new Error("init failed"));
    render(<LocationPermissionHelp ua={UA_IPHONE_LINE} origin={ORIGIN} />);

    fireEvent.click(screen.getByTestId("button-open-external-browser"));
    await waitFor(() => expect(loc.href).toBe(`${ORIGIN}/portal?openExternalBrowser=1`));
    expect(liffMock.openWindow).not.toHaveBeenCalled();
  });

  it("Android LINE：顯示 Android 步驟與改用瀏覽器按鈕", () => {
    render(<LocationPermissionHelp ua={UA_ANDROID_LINE} origin={ORIGIN} />);

    expect(screen.getByText("LINE 沒有取得定位權限")).toBeTruthy();
    expect(screen.getByText(/僅在使用應用程式時允許/)).toBeTruthy();
    expect(screen.queryByText(/隱私權與安全性/)).toBeNull();
    expect(screen.getByTestId("button-open-external-browser")).toBeTruthy();
  });

  it("iPhone Safari：顯示 Safari 步驟，沒有改用瀏覽器按鈕與網址", () => {
    render(<LocationPermissionHelp ua={UA_IPHONE_SAFARI} origin={ORIGIN} />);

    expect(screen.getByText("瀏覽器沒有取得定位權限")).toBeTruthy();
    expect(screen.getByText(/Safari 網站/)).toBeTruthy();
    expect(screen.queryByTestId("button-open-external-browser")).toBeNull();
    expect(screen.queryByTestId("button-copy-portal-url")).toBeNull();
    expect(screen.queryByText(`${ORIGIN}/portal`)).toBeNull();
  });

  it("Android Chrome：顯示 Chrome 步驟，沒有改用瀏覽器按鈕", () => {
    render(<LocationPermissionHelp ua={UA_ANDROID_CHROME} origin={ORIGIN} />);

    expect(screen.getByText("瀏覽器沒有取得定位權限")).toBeTruthy();
    expect(screen.getByText(/點網址列左邊的圖示/)).toBeTruthy();
    expect(screen.queryByTestId("button-open-external-browser")).toBeNull();
  });

  it("其他環境：顯示通用說明", () => {
    render(<LocationPermissionHelp ua={UA_DESKTOP_CHROME} origin={ORIGIN} />);

    expect(
      screen.getByText("請在瀏覽器的網站設定中允許此網站使用位置，並確認裝置的定位服務已開啟。"),
    ).toBeTruthy();
    expect(screen.queryByTestId("button-open-external-browser")).toBeNull();
  });

  it("LINE 內：複製網址按鈕把 /portal 網址寫進剪貼簿", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: UA_IPHONE_LINE });
    render(<LocationPermissionHelp ua={UA_IPHONE_LINE} origin={ORIGIN} />);

    fireEvent.click(screen.getByTestId("button-copy-portal-url"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/portal`));
    expect(await screen.findByText("已複製")).toBeTruthy();
  });

  it("LINE 內：剪貼簿寫入失敗時提示長按網址手動複製", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText }, userAgent: UA_IPHONE_LINE });
    render(<LocationPermissionHelp ua={UA_IPHONE_LINE} origin={ORIGIN} />);

    fireEvent.click(screen.getByTestId("button-copy-portal-url"));
    expect(await screen.findByText(/長按網址/)).toBeTruthy();
  });

  it("未傳入 ua 時讀 navigator.userAgent", () => {
    vi.stubGlobal("navigator", { userAgent: UA_IPHONE_LINE });
    render(<LocationPermissionHelp origin={ORIGIN} />);
    expect(screen.getByTestId("button-open-external-browser")).toBeTruthy();
  });
});
