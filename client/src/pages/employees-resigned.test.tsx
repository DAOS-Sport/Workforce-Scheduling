// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/region-context", () => ({ useRegion: () => ({ activeRegion: "A" }) }));
vi.mock("@/components/region-tabs", () => ({ RegionTabs: () => null }));
import EmployeesPage from "./employees";

const emp = (id: number, name: string, status: string) =>
  ({ id, name, employeeCode: "E" + id, phone: null, email: null, lineId: null, regionId: 1, status, role: "櫃台", employmentType: "part_time", isAdmin: false });
const requested: string[] = [];
afterEach(() => { cleanup(); requested.length = 0; });

function mount(list: any[]) {
  const q = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => {
    const p = queryKey.join("/");
    requested.push(p);
    if (p === "/api/employees/manage/A") return list;
    if (p === "/api/employees/A") return list.filter((e) => e.status === "active");
    if (p === "/api/regions") return [{ id: 1, code: "A", name: "測試區" }];
    return [];
  } } } });
  render(<QueryClientProvider client={q}><EmployeesPage /></QueryClientProvider>);
}

it("shows a resigned employee with the resigned badge after active ones", async () => {
  mount([emp(2, "離職測試員", "inactive"), emp(1, "在職測試員", "active")]);
  const row = await screen.findByTestId("row-employee-2");
  expect(within(row).getByText("離職")).toBeTruthy();
  const order = screen.getAllByTestId(/^row-employee-/).map((r) => r.getAttribute("data-testid"));
  expect(order).toEqual(["row-employee-1", "row-employee-2"]);
  expect(requested).toContain("/api/employees/manage/A");
  expect(requested).not.toContain("/api/employees/A");
});

it("search still narrows resigned employees", async () => {
  mount([emp(1, "在職測試員", "active"), emp(2, "離職測試員", "inactive")]);
  await screen.findByTestId("row-employee-2");
  fireEvent.change(screen.getByTestId("input-search-employee"), { target: { value: "離職" } });
  expect(screen.queryByTestId("row-employee-1")).toBeNull();
  expect(screen.getByTestId("row-employee-2")).toBeTruthy();
});
