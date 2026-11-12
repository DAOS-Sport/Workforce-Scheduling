// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { queryClient } from "./lib/queryClient";

// Keep the actual App guard, login page, monitor page, router and query client.
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SidebarTrigger: () => null,
}));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));

const START = "/it-monitor#clock.amendment";
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
const scrollIntoView = vi.fn();
let authenticated = false;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  authenticated = false;
  scrollIntoView.mockClear();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  queryClient.clear();
  window.history.replaceState({}, "", START);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/admin/me") return new Response(JSON.stringify(authenticated
      ? { id: 90001, name: "Synthetic admin", permissions: ["it-monitor:read"] }
      : { message: "unauthorized" }), { status: authenticated ? 200 : 401 });
    if (url === "/api/admin/login-options") return new Response(JSON.stringify({ sharedPasswordEnabled: true, lineEnabled: false }));
    if (url === "/api/admin/login" && init?.method === "POST") {
      authenticated = true;
      return new Response(JSON.stringify({ id: 90001 }));
    }
    if (url === "/api/admin/health") return new Response(JSON.stringify({
      system: "workforce-scheduling", build: "158d448", checkedAt: new Date().toISOString(), overall: "red",
      pipelines: [{ id: "clock.amendment", name: "Synthetic pipeline", level: "red", reason: "Synthetic failure", lastSuccessAt: null, lastFailureAt: null, source: "app_errors" }],
    }));
    if (url.startsWith("/api/admin/health/logs")) return new Response(JSON.stringify({ logs: [], nextCursor: null }));
    throw new Error(`Unexpected local fixture request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("monitor drill-down through the existing login gate", () => {
  it("renders the real login page in place and does not request monitor data before login", async () => {
    render(<App />);
    expect(await screen.findByTestId("admin-login-page")).toBeTruthy();
    expect(await screen.findByTestId("input-admin-password")).toBeTruthy();
    expect(window.location.pathname + window.location.hash).toBe(START);
    expect(screen.queryByTestId("pipeline-clock.amendment")).toBeNull();
    expect(screen.queryByTestId("health-summary")).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/admin/health"))).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("renders and scrolls to the real monitor card after password login, retaining the path and hash", async () => {
    render(<App />);
    const input = await screen.findByTestId("input-admin-password");
    expect(screen.queryByTestId("pipeline-clock.amendment")).toBeNull();
    fireEvent.change(input, { target: { value: "synthetic-test-password" } });
    fireEvent.click(screen.getByTestId("button-admin-login"));
    const card = await screen.findByTestId("pipeline-clock.amendment");
    expect(card.id).toBe("clock.amendment");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(card);
    await waitFor(() => expect(screen.queryByTestId("admin-login-page")).toBeNull());
    expect(window.location.pathname + window.location.hash).toBe(START);
  });

  it("keeps an unknown hash without scrolling after the real monitor data loads", async () => {
    authenticated = true;
    window.history.replaceState({}, "", "/it-monitor#unknown.pipeline");
    render(<App />);
    expect(await screen.findByTestId("pipeline-clock.amendment")).toBeTruthy();
    expect(window.location.pathname + window.location.hash).toBe("/it-monitor#unknown.pipeline");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
