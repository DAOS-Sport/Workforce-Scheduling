// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminLoginPage from "./admin-login";

afterEach(() => vi.unstubAllGlobals());

describe("admin login choices", () => {
  it("offers personal LINE login and removes shared password and dev-login when the server disables them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lineEnabled: true, sharedPasswordEnabled: false }) }));
    render(<AdminLoginPage onLoginSuccess={() => {}} />);
    await waitFor(() => expect((screen.getByTestId("button-admin-line-login") as HTMLButtonElement).disabled).toBe(false));
    expect(document.body.contains(screen.queryByTestId("input-admin-password"))).toBe(false);
    expect(document.body.contains(screen.queryByTestId("button-dev-login"))).toBe(false);
    expect(document.body.contains(screen.getByText("共用密碼登入已停用，請使用個人 LINE 登入。"))).toBe(true);
  });

  it("keeps password login when enabled and sends only the entered password", async () => {
    const onLogin = vi.fn();
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => ({ ok: true, json: async () => init?.method === "POST" ? { id: -1 } : { lineEnabled: true, sharedPasswordEnabled: true } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminLoginPage onLoginSuccess={onLogin} />);
    const input = await screen.findByTestId("input-admin-password");
    fireEvent.change(input, { target: { value: "test-password" } });
    fireEvent.click(screen.getByTestId("button-admin-login"));
    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/login", expect.objectContaining({ body: JSON.stringify({ password: "test-password" }), credentials: "include" }));
  });
});
