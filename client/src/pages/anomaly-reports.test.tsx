// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnomalyCard } from "./anomaly-reports";

const IMG_A = "data:image/png;base64,AAAA";
const IMG_B = "data:image/png;base64,BBBB";

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    employeeId: 7,
    employeeName: "測試員工",
    employeeCode: "7001",
    role: "教練",
    lineUserId: null,
    context: "打卡異常",
    clockStatus: "fail",
    clockType: "in",
    clockTime: null,
    venueName: "測試場館",
    distance: null,
    failReason: "不在範圍內",
    errorMsg: null,
    userNote: null,
    imageCount: 2,
    reportText: "報告內文",
    resolution: "pending",
    resolvedNote: null,
    createdAt: "2026-11-03T01:00:00.000Z",
    ...overrides,
  };
}

function renderCard(r: ReturnType<typeof report>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnomalyCard report={r as never} isSelected={false} onSelect={() => {}} onDelete={() => {}} />
    </QueryClientProvider>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: 5, imageUrls: [IMG_A, IMG_B] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnomalyCard images", () => {
  it("collapsed: shows the image count and sends no request", () => {
    renderCard(report({ imageCount: 2 }));

    expect(screen.getByTestId("text-image-count-5").textContent).toContain("2");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("collapsed: no image count when the report has no images", () => {
    renderCard(report({ imageCount: 0 }));

    expect(screen.queryByTestId("text-image-count-5")).toBeNull();
  });

  it("expanded: fetches the single report once, shows loading then the images", async () => {
    renderCard(report({ imageCount: 2 }));

    fireEvent.click(screen.getByTestId("text-anomaly-employee-5"));

    expect(screen.getByTestId("text-images-loading-5")).toBeTruthy();
    const img0 = await screen.findByTestId("img-anomaly-5-0");
    expect(img0.querySelector("img")?.getAttribute("src")).toBe(IMG_A);
    expect(screen.getByTestId("img-anomaly-5-1").querySelector("img")?.getAttribute("src")).toBe(IMG_B);
    expect(screen.queryByTestId("text-images-loading-5")).toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/anomaly-reports/5");
  });

  it("expanded with no images: never requests the single report", async () => {
    renderCard(report({ imageCount: 0 }));

    fireEvent.click(screen.getByTestId("text-anomaly-employee-5"));

    await waitFor(() => expect(screen.getByTestId("input-note-5")).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("expanded: shows an error line when the single report cannot be loaded", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "err", text: async () => "boom" });
    renderCard(report({ imageCount: 1 }));

    fireEvent.click(screen.getByTestId("text-anomaly-employee-5"));

    expect(await screen.findByTestId("text-images-error-5")).toBeTruthy();
  });
});
