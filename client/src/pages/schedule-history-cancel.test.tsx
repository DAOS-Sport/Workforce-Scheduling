// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const region = vi.hoisted(() => ({ activeRegion: "A", selectedRegions: ["A"], toggleSelectedRegion: () => {} }));
vi.mock("@/lib/region-context", () => ({ useRegion: () => region }));
vi.mock("@/components/region-tabs", () => ({ RegionTabs: () => null }));
vi.mock("@/components/region-pills", () => ({ RegionPills: () => null }));
vi.mock("@/components/GoogleSheetsImportDialog", () => ({ GoogleSheetsImportDialog: () => null }));
import SchedulePage from "./schedule";

HTMLElement.prototype.scrollIntoView = vi.fn();

// Pin "today" to the middle of a month so the same month holds past, today and future shifts.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));

const resigned = { id: 2, name: "歷史測試員", employeeCode: "H", role: "教練", employmentType: "part_time", regionId: 1, status: "inactive" };
const shift = (id: number, date: string) => ({ id, employeeId: 2, venueId: 1, date, startTime: "09:00", endTime: "12:00", role: "教練", status: "active", isDispatch: false });
const shifts = [shift(41, "2026-10-01"), shift(42, "2026-10-15"), shift(43, "2026-10-20")];

const requests: { method: string; url: string; body: any }[] = [];
beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ method: init?.method || "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ deletedCount: 1 }), text: async () => "" } as any;
  }));
  localStorage.setItem("schedule_visible_A", "[2]");
  localStorage.setItem("schedule_seen_A", "[2]");
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

function mount() {
  const q = new QueryClient({ defaultOptions: { queries: { retry: false, initialData: () => [], queryFn: async ({ queryKey }) => {
    const p = queryKey.join("/");
    if (p.startsWith("/api/employees/schedule/")) return [resigned];
    if (p.startsWith("/api/employees")) return [];
    if (p.startsWith("/api/shifts/")) return shifts;
    if (p === "/api/regions") return [{ id: 1, code: "A", name: "測試區" }];
    if (p.startsWith("/api/venues")) return [{ id: 1, shortName: "測試場", name: "測試場", regionId: 1 }];
    if (p.includes("precheck")) return { warnings: [] };
    return [];
  } } } });
  render(<QueryClientProvider client={q}><SchedulePage /></QueryClientProvider>);
  return q;
}

it("offers cancel on a resigned employee's shifts from today on, not on past ones", async () => {
  mount();
  await screen.findByTestId("row-employee-2");
  expect(screen.queryByTestId("button-cancel-history-shift-41")).toBeNull();
  expect(screen.getByTestId("button-cancel-history-shift-42")).toBeTruthy();
  expect(screen.getByTestId("button-cancel-history-shift-43")).toBeTruthy();
  expect(screen.queryByTestId("button-add-shift-2-2026-10-20")).toBeNull();
});

it("cancels one upcoming shift through the usual confirm dialog", async () => {
  mount();
  await screen.findByTestId("row-employee-2");
  fireEvent.click(screen.getByTestId("button-cancel-history-shift-43"));
  fireEvent.click(await screen.findByTestId("button-batch-delete-execute"));
  await waitFor(() => expect(requests.some((r) => r.url === "/api/shifts/batch-delete-ids")).toBe(true));
  const sent = requests.find((r) => r.url === "/api/shifts/batch-delete-ids")!;
  expect(sent.method).toBe("POST");
  expect(sent.body).toEqual({ shiftIds: [43] });
});

it("lets multi-select pick upcoming shifts of a resigned employee but not past ones", async () => {
  mount();
  await screen.findByTestId("row-employee-2");
  fireEvent.click(screen.getByTestId("button-toggle-multi-select"));
  fireEvent.click(screen.getByTestId("shift-41"));
  expect(screen.queryByTestId("button-batch-delete-confirm")).toBeNull();
  fireEvent.click(screen.getByTestId("shift-43"));
  fireEvent.click(screen.getByTestId("shift-42"));
  expect((await screen.findByTestId("button-batch-delete-confirm")).textContent).toContain("(2)");
});
