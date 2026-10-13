// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const region = vi.hoisted(() => ({ activeRegion: "A", selectedRegions: ["A"], toggleSelectedRegion: () => {} }));
vi.mock("@/lib/region-context", () => ({ useRegion: () => region }));
vi.mock("@/components/region-tabs", () => ({ RegionTabs: () => null }));
vi.mock("@/components/region-pills", () => ({ RegionPills: () => null }));
vi.mock("@/components/GoogleSheetsImportDialog", () => ({ GoogleSheetsImportDialog: () => null }));
import SchedulePage from "./schedule";

HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => { cleanup(); localStorage.clear(); });

const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
const cleaner = (status: string) => ({ id: 9, name: "清潔測試員", employeeCode: "K", role: "清潔", employmentType: "part_time", regionId: 1, status });
const shifts = [{ id: 30, employeeId: 9, venueId: 1, date, startTime: "09:00", endTime: "12:00", role: "清潔", status: "active", isDispatch: false }];

function client(status: string, historyFails = false) {
  const q = new QueryClient({ defaultOptions: { queries: { retry: false, initialData: () => [], queryFn: async ({ queryKey }) => {
    const p = queryKey.join("/");
    if (p.startsWith("/api/employees/schedule/")) return [cleaner(status)];
    if (p.startsWith("/api/employees")) return status === "active" ? [cleaner(status)] : [];
    if (p.startsWith("/api/shifts/")) return shifts;
    if (p === "/api/regions") return [{ id: 1, code: "A", name: "測試區" }];
    if (p.startsWith("/api/venues")) return [{ id: 1, shortName: "測試場", name: "測試場", regionId: 1 }];
    if (p.includes("precheck")) return { warnings: [] };
    return [];
  } } } });
  if (historyFails) {
    // The history query has no data at all, like a 500 or an old backend answering with HTML.
    q.setQueryDefaults(["/api/employees", "schedule"], { initialData: undefined, queryFn: async () => { throw new Error("500: history unavailable"); } });
  }
  return q;
}
const settle = (q: QueryClient) => waitFor(() => expect(q.isFetching()).toBe(0));

it("shows a resigned employee whose role fits no group under 其他（離職）", async () => {
  localStorage.setItem("schedule_visible_A", "[9]");
  localStorage.setItem("schedule_seen_A", "[9]");
  const q = client("inactive");
  render(<QueryClientProvider client={q}><SchedulePage /></QueryClientProvider>);
  const row = await screen.findByTestId("row-employee-9");
  expect(row.textContent).toContain("離職／歷史紀錄");
  expect(screen.getByText("其他（離職） (1)")).toBeTruthy();
  expect(screen.getByTestId("shift-30").textContent).toContain("09:00–12:00");
  expect(screen.queryByTestId("button-add-shift-9-" + date)).toBeNull();
});

it("lets a hidden out-of-group resigned employee be re-shown from the picker", async () => {
  localStorage.setItem("schedule_visible_A", "[]");
  localStorage.setItem("schedule_seen_A", "[9]");
  const q = client("inactive");
  render(<QueryClientProvider client={q}><SchedulePage /></QueryClientProvider>);
  await settle(q);
  expect(screen.queryByTestId("row-employee-9")).toBeNull();
  fireEvent.click(screen.getByTestId("button-employee-picker"));
  expect(await screen.findByTestId("picker-group-history-other")).toBeTruthy();
  fireEvent.click(screen.getByTestId("picker-emp-9"));
  expect(await screen.findByTestId("row-employee-9")).toBeTruthy();
});

it("keeps active employees out of the 其他（離職） group", async () => {
  localStorage.setItem("schedule_visible_A", "[9]");
  localStorage.setItem("schedule_seen_A", "[9]");
  const q = client("active");
  render(<QueryClientProvider client={q}><SchedulePage /></QueryClientProvider>);
  await settle(q);
  expect(screen.queryByText(/其他（離職）/)).toBeNull();
  expect(screen.queryByTestId("row-employee-9")).toBeNull();
});

it("does not re-render forever when the history query has no data", async () => {
  let commits = 0;
  const q = client("inactive", true);
  render(
    <React.Profiler id="schedule" onRender={() => { commits++; if (commits > 400) throw new Error("render loop: " + commits + " commits"); }}>
      <QueryClientProvider client={q}><SchedulePage /></QueryClientProvider>
    </React.Profiler>,
  );
  await settle(q);
  await new Promise((r) => setTimeout(r, 300));
  const settled = commits;
  await new Promise((r) => setTimeout(r, 300));
  expect(commits).toBe(settled);
  expect(commits).toBeLessThan(100);
});
