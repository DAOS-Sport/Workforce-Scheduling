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
const written = vi.hoisted(() => ({ calls: [] as { workbook: any; fileName: string }[] }));
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: (workbook: any, fileName: string) => { written.calls.push({ workbook, fileName }); } };
});
import * as XLSX from "xlsx";
import SchedulePage from "./schedule";

HTMLElement.prototype.scrollIntoView = vi.fn();
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));

const person = (id: number, name: string, status: string) => ({ id, name, employeeCode: "E" + id, role: "救生", employmentType: "part_time", regionId: 1, status });
const active = person(1, "在職員", "active");
const resigned = person(2, "離職員", "inactive");
const hidden = person(3, "沒勾選", "active");
const shift = (id: number, employeeId: number, date: string, start: string, end: string) => ({ id, employeeId, venueId: 1, date, startTime: start, endTime: end, role: "救生", status: "active", isDispatch: false, notes: null });
const shifts = [
  shift(1, 1, "2026-09-23", "06:00", "14:00"), shift(2, 1, "2026-09-23", "14:00", "22:00"),
  shift(3, 2, "2026-09-10", "06:00", "14:00"), shift(4, 3, "2026-09-11", "06:00", "14:00"),
];

beforeEach(() => {
  written.calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200, statusText: "OK", text: async () => "",
    json: async () => (String(url).startsWith("/api/venue-shift-templates/1") ? [{ id: 1, venueId: 1, dayType: "weekday", shiftLabel: "早班", startTime: "06:00", endTime: "14:00", role: "救生", requiredCount: 1 }] : []),
  } as any)));
  localStorage.setItem("schedule_visible_A", "[1,2]");
  localStorage.setItem("schedule_seen_A", "[1,2,3]");
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

function mount(list = shifts) {
  const q = new QueryClient({ defaultOptions: { queries: { retry: false, initialData: () => [], queryFn: async ({ queryKey }) => {
    const p = queryKey.join("/");
    if (p.startsWith("/api/employees/schedule/")) return [active, resigned, hidden];
    if (p.startsWith("/api/employees")) return [active, hidden];
    if (p.startsWith("/api/shifts/")) return list;
    if (p === "/api/regions") return [{ id: 1, code: "A", name: "測試區" }];
    if (p.startsWith("/api/venues")) return [{ id: 1, shortName: "測試場", name: "測試場", regionId: 1 }];
    if (p.includes("precheck")) return { warnings: [] };
    return [];
  } } } });
  render(<QueryClientProvider client={q}><SchedulePage /></QueryClientProvider>);
}

it("exports the shifts of the employees on screen, one row per shift", async () => {
  mount();
  await screen.findByTestId("row-employee-2");
  fireEvent.click(screen.getByTestId("button-export-schedule"));
  await waitFor(() => expect(written.calls).toHaveLength(1));
  const { workbook, fileName } = written.calls[0];
  expect(fileName).toBe("班表_2026年9月_測試區.xlsx");
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets["班表"]);
  expect(rows.map((r) => [r["日期"], r["姓名"], r["身分"], r["班別"] ?? "", r["開始"], r["結束"]])).toEqual([
    ["2026-09-10", "離職員", "離職", "早班", "06:00", "14:00"],
    ["2026-09-23", "在職員", "在職", "早班", "06:00", "14:00"],
    ["2026-09-23", "在職員", "在職", "", "14:00", "22:00"],
  ]);
});

it("writes no file when nobody on screen has a shift", async () => {
  mount([]);
  await waitFor(() => expect(screen.getByTestId("button-export-schedule")).toBeTruthy());
  fireEvent.click(screen.getByTestId("button-export-schedule"));
  await new Promise((r) => setTimeout(r, 200));
  expect(written.calls).toHaveLength(0);
});
