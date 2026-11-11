// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AuditPage from "./audit";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const item = {
  id: "operation:1", entity: "clock_records", recordId: "71", employeeId: 321,
  at: "2026-11-11T06:30:00Z", action: "update", actor: { kind: "personal", employeeId: 123, name: "測試操作員" },
  before: { status: "warning" }, after: { status: "success" },
};
function view() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}><AuditPage /></QueryClientProvider>);
}
it("shows the operator snapshot, Taipei time, and before/after contents", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [item], nextCursor: null }) }));
  view();
  expect(await screen.findByText("個人帳號：測試操作員（123）")).toBeTruthy();
  expect(screen.getByText(/14:30:00/)).toBeTruthy();
  expect(screen.getByText(/"warning"/)).toBeTruthy();
  expect(screen.getByText(/"success"/)).toBeTruthy();
});
it("queries the chosen employee and record, and can reach older pages", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => ({ items: [item], nextCursor: url.includes("cursor=") ? null : "100" }) }));
  vi.stubGlobal("fetch", fetcher);
  view();
  await screen.findByText("個人帳號：測試操作員（123）");
  fireEvent.change(screen.getByLabelText("員工 ID"), { target: { value: "321" } });
  fireEvent.change(screen.getByLabelText("資料類別"), { target: { value: "clock_records" } });
  fireEvent.change(screen.getByLabelText("資料 ID"), { target: { value: "71" } });
  fireEvent.click(screen.getByText("查詢"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("employeeId=321&entity=clock_records&recordId=71"), { credentials: "include" }));
  await screen.findByText("個人帳號：測試操作員（123）");
  fireEvent.click(screen.getByText("下一頁"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("cursor=100"), { credentials: "include" }));
  await screen.findByText("個人帳號：測試操作員（123）");
  fireEvent.click(screen.getByText("上一頁"));
  await waitFor(() => expect((screen.getByText("上一頁") as HTMLButtonElement).disabled).toBe(true));
});
it("shows an unreadable query and an unattributed portal operator honestly", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  view();
  expect((await screen.findByRole("alert")).textContent).toContain("操作紀錄讀取失敗");
  cleanup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ ...item, actor: { kind: "employee" } }], nextCursor: null }) }));
  view();
  expect(await screen.findByText("員工入口：身分未提供")).toBeTruthy();
});
