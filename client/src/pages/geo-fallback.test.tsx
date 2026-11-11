// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiffClockInPage from "./liff-clock-in";
import { RadarClockIn, getClockPosition } from "./portal";
import { UA_IPHONE_LINE, UA_ANDROID_LINE, UA_IPHONE_SAFARI } from "@/lib/__fixtures__/user-agents";

vi.mock("@line/liff", () => ({ default: {
  init: vi.fn().mockResolvedValue(undefined), isLoggedIn: () => true,
  getProfile: async () => ({ userId: "U_SYNTHETIC_GEO", displayName: "合成員工" }),
  isInClient: () => true, openWindow: vi.fn(), login: vi.fn(),
} }));

const employee = { id: 991, name: "合成員工", employeeCode: "SYNTHETIC", role: "教練" };
const position = { coords: { latitude: 25, longitude: 121, accuracy: 10 }, timestamp: Date.now() } as GeolocationPosition;
const result = { status: "success", clockType: "out", venueName: "合成場館", distance: 1, radius: 300,
  time: "21:04", date: "2026-11-11", shiftInfo: null, failReason: null, employeeName: "合成員工", userLat: null, userLng: null };
let geo: ReturnType<typeof vi.fn>;
let query: ReturnType<typeof vi.fn>;
let failedResult = false;

beforeEach(() => {
  localStorage.clear();
  vi.setSystemTime(new Date("2026-11-11T13:04:05Z"));
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: UA_IPHONE_LINE });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  geo = vi.fn((ok: PositionCallback) => ok(position));
  query = vi.fn().mockResolvedValue({ state: "prompt" });
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: geo } });
  Object.defineProperty(navigator, "permissions", { configurable: true, value: { query } });
  failedResult = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => url === "/api/portal/verify" ? employee
      : url === "/api/liff/clock-in" ? (failedResult ? { ...result, status: "fail", failReason: "不在任何場館範圍內" } : result)
      : url === "/api/portal/clock-amendment" ? { status: "pending" } : [],
    text: async () => "",
  })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function start(entry: "liff" | "portal") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => [] } } });
  render(<QueryClientProvider client={client}>{entry === "liff" ? <LiffClockInPage /> : <RadarClockIn employee={employee} />}</QueryClientProvider>);
  fireEvent.click(await screen.findByTestId(entry === "liff" ? "button-clock-in" : "button-clock-out"));
}
function calls(url: string) { return vi.mocked(fetch).mock.calls.filter(([u]) => u === url); }
async function uploadEvidence() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,c3ludGhldGlj");
  vi.stubGlobal("Image", class {
    width = 20; height = 20; onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  fireEvent.change(screen.getByTestId("input-amendment-evidence"), {
    target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })] },
  });
  await screen.findByAltText("截圖預覽");
}

describe.each(["liff", "portal"] as const)("%s 定位退路", entry => {
  it.each([
    ["PERMISSION_DENIED", 1], ["POSITION_UNAVAILABLE", 2], ["TIMEOUT", 3],
    ["UNSUPPORTED", 0], ["INSECURE_CONTEXT", 0], ["POOR_ACCURACY", 0], ["UNKNOWN", 9],
  ])("%s：三條退路、預填補卡、僅待審與去個資回報", async (kind, code) => {
    if (kind === "UNSUPPORTED") Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    else if (kind === "INSECURE_CONTEXT") Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    else if (kind === "POOR_ACCURACY") { geo.mockImplementation(ok => ok({ ...position, coords: { ...position.coords, accuracy: 800 } })); failedResult = true; }
    else geo.mockImplementation((_ok, fail) => fail({ code, message: "raw private detail 25,121 U_SECRET" }));
    await start(entry);
    expect(await screen.findByRole("button", { name: "重新取得位置" })).toBeTruthy();
    expect(screen.getByTestId("button-open-external-browser")).toBeTruthy();
    const amendment = screen.getByRole("button", { name: "無法定位，改送補打卡申請" });
    expect(amendment).toBeTruthy();
    const logs = calls("/api/anomaly-report").map(([, init]) => JSON.parse(String(init?.body)));
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) expect(log).toEqual({ event: "geolocation_failure", kind, entry, platform: "iOS", inLine: true });
    fireEvent.click(amendment);
    expect((await screen.findByTestId("input-amendment-notes") as HTMLTextAreaElement).value).toBe(`定位失敗：${kind}`);
    expect((screen.getByTestId("input-amendment-time") as HTMLInputElement).value).toBe("21:04");
    // LIFF 的原入口自動判斷方向；補卡表單讓員工明確選擇，portal 帶入原按鈕方向。
    if (entry === "liff") {
      expect(screen.getByTestId("button-amendment-type-in").className).not.toContain("bg-juns-teal");
      expect(screen.getByTestId("button-amendment-type-out").className).not.toContain("bg-juns-teal");
      fireEvent.click(screen.getByTestId("button-amendment-type-out"));
    } else {
      expect(screen.getByTestId("button-amendment-type-out").className).toContain("bg-juns-teal");
    }
    await uploadEvidence();
    fireEvent.click(screen.getByTestId("button-submit-amendment"));
    expect(await screen.findByText("已送出，待主管審核")).toBeTruthy();
    const payload = JSON.parse(String(calls("/api/portal/clock-amendment")[0][1]?.body));
    expect(payload).toMatchObject({ employeeId: employee.id, clockType: "out", requestedTime: "2026-11-11T21:04:00+08:00", reason: `其他：定位失敗：${kind}`, isSystemIssue: false });
    expect(payload.evidenceImageUrl).toContain("data:image/jpeg");
    expect(calls("/api/liff/clock-in")).toHaveLength(kind === "POOR_ACCURACY" ? 1 : 0);
    expect(screen.queryByText(/打卡成功/)).toBeNull();
  });

  it.each([UA_IPHONE_LINE, UA_ANDROID_LINE, UA_IPHONE_SAFARI])("已拒絕的舊員工先查權限；只在LINE顯示外開", async ua => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
    query.mockResolvedValue({ state: "denied" });
    await start(entry);
    expect(await screen.findByRole("button", { name: "重新取得位置" })).toBeTruthy();
    expect(query).toHaveBeenCalledWith({ name: "geolocation" });
    expect(geo).not.toHaveBeenCalled();
    expect(Boolean(screen.queryByTestId("button-open-external-browser"))).toBe(/Line\//i.test(ua));
  });
  it("重取真的再定位，失敗不鎖住原方向", async () => {
    geo.mockImplementation((_ok, fail) => fail({ code: 1 }));
    await start(entry);
    const retry = await screen.findByRole("button", { name: "重新取得位置" });
    geo.mockImplementation(ok => ok(position));
    fireEvent.click(retry);
    await waitFor(() => expect(calls("/api/liff/clock-in")).toHaveLength(1));
    if (entry === "portal") expect(JSON.parse(String(calls("/api/liff/clock-in")[0][1]?.body)).clockType).toBe("out");
  });
  it("精度差但既有API判成功時維持成功，不新增精度門檻", async () => {
    geo.mockImplementation(ok => ok({ ...position, coords: { ...position.coords, accuracy: 800 } }));
    await start(entry);
    await waitFor(() => expect(calls("/api/liff/clock-in")).toHaveLength(1));
    expect(await screen.findByText(/下班打卡成功/)).toBeTruthy();
    expect(calls("/api/anomaly-report")).toHaveLength(0);
  });
});

describe("定位取得策略", () => {
  it.each([2, 3])("高精度code %s後僅低精度重試一次，timeout加長、快取不超過120000", async code => {
    geo.mockImplementationOnce((_ok, fail) => fail({ code })).mockImplementationOnce(ok => ok(position));
    await expect(getClockPosition("portal")).resolves.toEqual(position);
    expect(geo).toHaveBeenCalledTimes(2);
    const options = geo.mock.calls.map(c => c[2]);
    expect(options[0]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
    expect(options[1]).toMatchObject({ enableHighAccuracy: false, maximumAge: 120000 });
    expect(options[1].timeout).toBeGreaterThan(options[0].timeout);
  });
  it("不支援Permissions或query拒絕時照原流程，第一次授權由按鈕觸發", async () => {
    query.mockRejectedValue(new TypeError("unsupported"));
    await expect(getClockPosition("liff")).resolves.toEqual(position);
    expect(geo).toHaveBeenCalledTimes(1);
  });
  it.each([2, 3])("兩次code%s後停止，逐次回報且不開第三次定位", async code => {
    geo.mockImplementation((_ok, fail) => fail({ code }));
    await expect(getClockPosition("portal")).rejects.toMatchObject({ code });
    expect(geo).toHaveBeenCalledTimes(2);
    expect(calls("/api/anomaly-report")).toHaveLength(2);
  });
  it("WebView完全不回呼也在兩次有界等待後提供退路", async () => {
    vi.useFakeTimers(); geo.mockImplementation(() => {});
    let settled = false;
    const pending = getClockPosition("portal").catch(err => { settled = true; return err; });
    await act(async () => { await vi.advanceTimersByTimeAsync(45000); });
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({ code: 3 });
    expect(geo).toHaveBeenCalledTimes(2);
  });
});

it("LIFF再次定位失敗仍要求員工明確選擇補卡方向", async () => {
  failedResult = true;
  geo.mockImplementation(ok => ok({ ...position, coords: { ...position.coords, accuracy: 800 } }));
  await start("liff");
  const retry = await screen.findByRole("button", { name: "重新取得位置" });
  geo.mockImplementation((_ok, fail) => fail({ code: 3 }));
  fireEvent.click(retry);
  fireEvent.click(await screen.findByRole("button", { name: "無法定位，改送補打卡申請" }));
  const inButton = await screen.findByTestId("button-amendment-type-in");
  expect(inButton.className).not.toContain("bg-juns-teal");
  expect(screen.getByTestId("button-amendment-type-out").className).not.toContain("bg-juns-teal");
});

it("LIFF補卡即使已附截圖，仍必須先選上下班才能送出", async () => {
  geo.mockImplementation((_ok, fail) => fail({ code: 1 }));
  await start("liff");
  fireEvent.click(await screen.findByRole("button", { name: "無法定位，改送補打卡申請" }));
  await screen.findByTestId("input-amendment-notes");
  await uploadEvidence();
  const submit = screen.getByTestId("button-submit-amendment") as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(submit);
  expect(calls("/api/portal/clock-amendment")).toHaveLength(0);
  fireEvent.click(screen.getByTestId("button-amendment-type-in"));
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  expect(await screen.findByText("已送出，待主管審核")).toBeTruthy();
  expect(JSON.parse(String(calls("/api/portal/clock-amendment")[0][1]?.body)).clockType).toBe("in");
});
