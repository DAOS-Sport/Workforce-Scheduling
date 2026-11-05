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

  it("權限被拒（code 1）→ 引導卡片內附上定位權限說明", async () => {
    await renderAndWaitReady();
    setGeoError(1);

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByTestId("card-permission-guide").querySelector('[data-testid="location-permission-help"]')).not.toBeNull()
    );
  });

  it("逾時（code 3）→ 不顯示定位權限說明", async () => {
    await renderAndWaitReady();
    setGeoError(3);

    fireEvent.click(screen.getByTestId("button-clock-in"));

    await waitFor(() =>
      expect(screen.getByText(/定位逾時/)).toBeTruthy()
    );
    expect(screen.queryByTestId("location-permission-help")).toBeNull();
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

describe("重送去重 — request id", () => {
  const sentRequestIds = () =>
    vi.mocked(global.fetch).mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).requestId);

  async function pressAndSettle(expected: string) {
    fireEvent.click(screen.getByTestId("button-clock-in"));
    await waitFor(() => screen.getByText(expected));
  }

  it("每次送出都帶 requestId", async () => {
    mockFetchOnce(SUCCESS_RESULT);
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(sentRequestIds()[0]).toEqual(expect.any(String));
    expect(sentRequestIds()[0].length).toBeGreaterThan(8);
  });

  it("沒拿到伺服器回覆（斷線）再按一次，沿用同一個 requestId", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("網路中斷"));
    mockFetchOnce(SUCCESS_RESULT);
    await renderAndWaitReady();

    await pressAndSettle("網路中斷");
    fireEvent.click(screen.getByTestId("button-retry"));
    fireEvent.click(await screen.findByTestId("button-clock-in"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const [first, second] = sentRequestIds();
    expect(second).toBe(first);
  });

  it("伺服器回 5xx 再按一次，沿用同一個 requestId", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.resolve({ message: "閘道錯誤" }) } as Response);
    mockFetchOnce(SUCCESS_RESULT);
    await renderAndWaitReady();

    await pressAndSettle("閘道錯誤");
    fireEvent.click(screen.getByTestId("button-retry"));
    fireEvent.click(await screen.findByTestId("button-clock-in"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const [first, second] = sentRequestIds();
    expect(second).toBe(first);
  });

  it("拿到成功回覆後，下一次按下（例如下班打卡）換新的 requestId", async () => {
    mockFetchOnce(SUCCESS_RESULT);
    mockFetchOnce({ ...SUCCESS_RESULT, clockType: "out" });
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));
    await waitFor(() => screen.getByTestId("button-clock-again"));
    fireEvent.click(screen.getByTestId("button-clock-again"));
    await waitFor(() => screen.getByTestId("button-clock-in"));
    fireEvent.click(screen.getByTestId("button-clock-in"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const [first, second] = sentRequestIds();
    expect(second).not.toBe(first);
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

describe("防呆 — 按鈕在成功打卡前不鎖死、不消失", () => {
  it("定位／送出進行中時，打卡按鈕仍保留在畫面上（不會按一次就消失）", async () => {
    mockGetCurrentPosition.mockImplementation(() => {}); // 永不回呼 → 停在「定位中」
    await renderAndWaitReady();

    fireEvent.click(screen.getByTestId("button-clock-in"));

    // 進入定位中後，按鈕本體仍在 DOM，而非被換成沒有按鈕的轉圈畫面
    await waitFor(() =>
      expect(screen.getByTestId("button-clock-in")).toBeInTheDocument()
    );
    expect(screen.getByTestId("button-clock-in")).toBeInTheDocument();
  });

  it("進行中重複點擊不會重複觸發定位／送出（防止重送）", async () => {
    mockGetCurrentPosition.mockImplementation(() => {}); // 永不回呼 → 維持 in-flight
    await renderAndWaitReady();

    const btn = screen.getByTestId("button-clock-in");
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    // inFlightRef 擋掉後續點擊 → 只請求一次定位
    await waitFor(() => expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1));
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
