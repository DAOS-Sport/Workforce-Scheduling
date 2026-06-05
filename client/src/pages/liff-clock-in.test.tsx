// @vitest-environment jsdom

/**
 * liff-clock-in.tsx 元件整合測試
 *
 * 驗證整個打卡流程在前端的正確性：
 *  - 開啟即請求定位
 *  - 按下打卡按鈕再次請求定位
 *  - 定位成功 → 呼叫打卡 API → 顯示結果
 *  - 定位各種失敗情況 → 顯示對應錯誤 + 照片回報區
 *  - API 回傳 fail → 顯示失敗 + 照片回報區
 */

import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import LiffClockInPage from "./liff-clock-in";

// ── mock @line/liff（動態 import 會被 vi.mock 攔截）────────────────────────────
vi.mock("@line/liff", () => ({
  default: {
    init: vi.fn().mockResolvedValue(undefined),
    isLoggedIn: vi.fn().mockReturnValue(true),
    getProfile: vi.fn().mockResolvedValue({
      userId: "U123",
      displayName: "測試員工",
      pictureUrl: undefined,
    }),
    login: vi.fn(),
  },
}));

// ── geolocation mock ──────────────────────────────────────────────────────────
// jsdom 沒有實作 navigator.geolocation，用 vi.stubGlobal 整個替換
const mockGetCurrentPosition = vi.fn();

beforeAll(() => {
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition: mockGetCurrentPosition },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// ── helpers ───────────────────────────────────────────────────────────────────

const SUCCESS_RESULT = {
  status: "success",
  clockType: "in",
  venueName: "測試場館",
  distance: 5,
  time: "08:10",
  date: "2026-05-27",
  shiftInfo: "08:00-17:00",
  failReason: null,
  employeeName: "測試員工",
  radius: 300,
};

const FAIL_RESULT = {
  ...SUCCESS_RESULT,
  status: "fail",
  distance: 1500,
  shiftInfo: null,
  failReason: "不在任何場館範圍內",
};

function mockFetchOnce(body: object, ok = true) {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok,
    json: () => Promise.resolve(body),
  } as Response);
}

function setGeoSuccess() {
  mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
    success({
      coords: { latitude: 25.0, longitude: 121.0, accuracy: 10 },
    } as GeolocationPosition);
  });
}

function setGeoError(code: number) {
  mockGetCurrentPosition.mockImplementation(
    (_success: PositionCallback, error?: PositionErrorCallback) => {
      error?.({ code, message: "error" } as GeolocationPositionError);
    }
  );
}

// ── 共用 setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  setGeoSuccess(); // 預設定位成功
  vi.stubGlobal("fetch", vi.fn());
});

// ── 等待初始化完成 ─────────────────────────────────────────────────────────────

async function renderAndWaitReady() {
  render(<LiffClockInPage />);
  await waitFor(() =>
    expect(screen.getByTestId("button-clock-in")).toBeInTheDocument()
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("初始化", () => {
  it("LIFF 初始化後顯示員工姓名", async () => {
    await renderAndWaitReady();
    expect(screen.getByTestId("text-employee-info")).toHaveTextContent("測試員工");
  });

  it("LIFF 初始化完成後不自動請求定位（避免使用者誤按拒絕後被永久封鎖）", async () => {
    await renderAndWaitReady();
    // 為避免使用者在看懂畫面前誤按「拒絕」（瀏覽器會永久記住、之後無法再跳出請求），
    // 初始化後不主動請求定位；只有在使用者點「GPS 打卡」按鈕時才請求。
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });
});

describe("按下打卡按鈕 — 定位流程", () => {
  it("點擊按鈕後再次呼叫 getCurrentPosition", async () => {
    // 讓定位不馬上 resolve，方便計算呼叫次數
    mockGetCurrentPosition.mockImplementation(() => {});
    await renderAndWaitReady();

    const callsBefore = mockGetCurrentPosition.mock.calls.length;
    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() => {
      expect(mockGetCurrentPosition.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it("定位成功 → 呼叫 POST /api/liff/clock-in 並帶入 lat/lng", async () => {
    mockFetchOnce(SUCCESS_RESULT);
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/liff/clock-in",
        expect.objectContaining({ method: "POST" })
      )
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.latitude).toBe(25.0);
    expect(body.longitude).toBe(121.0);
    expect(body.lineUserId).toBe("U123");
  });

  it("定位成功 + API success → 顯示打卡成功卡片", async () => {
    mockFetchOnce(SUCCESS_RESULT);
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByTestId("card-clock-result")).toBeInTheDocument()
    );
    expect(screen.getByTestId("card-clock-result")).toHaveTextContent("上班打卡成功");
  });
});

describe("定位失敗錯誤處理", () => {
  it("權限被拒（code 1）→ 顯示設定引導 + 照片回報", async () => {
    await renderAndWaitReady();
    setGeoError(1);

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByTestId("card-permission-guide")).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByTestId("section-photo-proof")).toBeInTheDocument()
    );
  });

  it("GPS 不可用（code 2）→ 顯示錯誤訊息 + 照片回報", async () => {
    await renderAndWaitReady();
    setGeoError(2);

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByText(/無法取得您的位置/)).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByTestId("section-photo-proof")).toBeInTheDocument()
    );
  });

  it("定位逾時（code 3）→ 顯示錯誤訊息 + 照片回報", async () => {
    await renderAndWaitReady();
    setGeoError(3);

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByText(/定位逾時/)).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByTestId("section-photo-proof")).toBeInTheDocument()
    );
  });
});

describe("API 回傳各種結果", () => {
  it("API 回傳 fail（距離超出）→ 顯示失敗訊息 + 照片回報", async () => {
    mockFetchOnce(FAIL_RESULT);
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByTestId("card-clock-result")).toBeInTheDocument()
    );
    expect(screen.getByTestId("card-clock-result")).toHaveTextContent(
      "不在任何場館範圍內"
    );
    await waitFor(() =>
      expect(screen.getByTestId("section-photo-proof")).toBeInTheDocument()
    );
  });

  it("API 回傳 fail（未綁定）→ 顯示綁定說明 + 照片回報", async () => {
    mockFetchOnce({
      ...FAIL_RESULT,
      failReason: "LINE 帳號尚未綁定員工資料",
    });
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByTestId("card-not-bound-guide")).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByTestId("section-photo-proof")).toBeInTheDocument()
    );
  });

  it("API 回傳 warning（無排班）→ 顯示警告卡片", async () => {
    mockFetchOnce({ ...SUCCESS_RESULT, status: "warning", failReason: "今日無排班" });
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByTestId("card-clock-result")).toBeInTheDocument()
    );
    expect(screen.getByTestId("card-clock-result")).toHaveTextContent("打卡已記錄");
  });

  it("API 回傳 HTTP 錯誤 → 顯示錯誤訊息", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: "伺服器錯誤" }),
    } as Response);

    await renderAndWaitReady();
    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByText("伺服器錯誤")).toBeInTheDocument()
    );
  });
});

describe("再次打卡", () => {
  it("打卡成功後可按「再次打卡」回到 ready 狀態", async () => {
    mockFetchOnce(SUCCESS_RESULT);
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));
    await waitFor(() => screen.getByTestId("button-clock-again"));

    fireEvent.click(screen.getByTestId("button-clock-again"));
    await waitFor(() =>
      expect(screen.getByTestId("button-clock-in")).toBeInTheDocument()
    );
  });
});
