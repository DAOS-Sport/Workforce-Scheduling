// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/queryClient";
import PermissionsPage from "./permissions";

afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

function setup(canWrite = true) {
  const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => {
    if (init?.method === "PUT") return { ok: true };
    if (url === "/api/admin/me") return { permissions: canWrite ? ["permissions:read", "permissions:write"] : ["permissions:read"] };
    if (url === "/api/admin/permissions") return { roles: ["救生"], matrix: { "救生": [] } };
    if (url === "/api/admin/shared-password") return { enabled: true };
    if (url === "/api/admin/personal-logins") return [{ employeeId: 7, name: "個人測試", role: "救生", firstLoginAt: "2026-11-01T00:00:00Z", lastLoginAt: "2026-11-11T00:00:00Z" }];
    return {};
  } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<QueryClientProvider client={queryClient}><PermissionsPage /></QueryClientProvider>);
  return fetchMock;
}

describe("role permission settings", () => {
  it("adds read when write is checked and saves exact role permissions", async () => {
    const fetchMock = setup();
    const write = await screen.findByRole("checkbox", { name: "救生 員工管理 寫入" }) as HTMLInputElement;
    await waitFor(() => expect(write.disabled).toBe(false));
    fireEvent.click(write);
    expect((screen.getByRole("checkbox", { name: "救生 員工管理 讀取" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "儲存權限" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/permissions/%E6%95%91%E7%94%9F", expect.objectContaining({ method: "PUT", body: JSON.stringify({ permissions: ["employees:write", "employees:read"] }) })));
    expect(document.body.contains(screen.getByText("個人測試"))).toBe(true);
  });

  it("keeps a read-only permission viewer from editing the matrix or shared flag", async () => {
    setup(false);
    expect((await screen.findByRole("checkbox", { name: "救生 員工管理 寫入" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "停用共用密碼" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
