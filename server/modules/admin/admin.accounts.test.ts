import express from "express";
import session from "express-session";
import type { AddressInfo } from "net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentAuditActor } from "../../shared/audit/actor";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(), permissions: vi.fn(), employee: vi.fn(), byLine: vi.fn(), loginRecord: vi.fn(), exchange: vi.fn(), profile: vi.fn(),
}));
vi.mock("./admin.repository", () => ({ adminRepository: { sharedPasswordEnabled: mocks.enabled, rolePermissions: mocks.permissions, recordPersonalLogin: mocks.loginRecord } }));
vi.mock("../employee/employee.service", () => ({ employeeService: { getEmployee: mocks.employee, getEmployeesByLineId: mocks.byLine } }));
vi.mock("../../adapters/line", () => ({ exchangeLoginCode: mocks.exchange, fetchLoginProfile: mocks.profile }));
import { mountAdminAuthRoutes } from "./admin.routes";
import { gateAdminApi } from "../../shared/middleware/requireAdmin";

const employee = { id: 7, name: "個人測試", role: "主管職", status: "active", lineId: "U-test" };
async function withApp(run: (request: (path: string, body?: unknown) => Promise<Response>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.post("/_old-shared", (req, res) => { req.session.adminId = 7; res.json({ ok: true }); });
  const server = app.listen(0);
  mountAdminAuthRoutes(server, app);
  app.use(gateAdminApi);
  app.patch("/api/employees/:id", (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  let cookie = "";
  const request = async (path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return res;
  };
  try { await run(request); } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function lineLogin(request: (path: string, body?: unknown) => Promise<Response>) {
  const start = await (await request("/api/admin/line-login")).json();
  const state = new URL(start.url).searchParams.get("state");
  return request("/api/admin/line-callback", { code: "fake-code", state });
}

describe("personal LINE and legacy shared admin sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LINE_CHANNEL_ID", "test-channel"); vi.stubEnv("LINE_LOGIN_CHANNEL_SECRET", "test-secret"); vi.stubEnv("ADMIN_PASSWORD", "test-password");
    mocks.enabled.mockResolvedValue(true);
    mocks.permissions.mockResolvedValue(undefined);
    mocks.employee.mockResolvedValue(employee); mocks.byLine.mockResolvedValue([employee]);
    mocks.exchange.mockResolvedValue({ ok: true, json: async () => ({ access_token: "fake-access-token" }) });
    mocks.profile.mockResolvedValue({ ok: true, json: async () => ({ userId: "U-test" }) });
    mocks.loginRecord.mockResolvedValue(undefined);
  });

  it("binds the session to the verified employee and records personal login under that actor", async () => {
    let recordedActor: unknown;
    mocks.loginRecord.mockImplementation(async () => { recordedActor = currentAuditActor(); });
    await withApp(async (request) => {
      expect((await lineLogin(request)).status).toBe(200);
      const me = await (await request("/api/admin/me")).json();
      expect(me).toMatchObject({ id: 7, name: "個人測試", role: "主管職", authKind: "personal" });
      expect(me.permissions).toContain("employees:write");
      expect(recordedActor).toEqual({ kind: "personal", employeeId: 7, name: "個人測試" });
      expect(mocks.exchange).toHaveBeenCalledWith(expect.objectContaining({ code: "fake-code", redirectUri: expect.stringContaining("/admin/line-callback") }));
    });
  });

  it("rejects a wrong or replayed state before exchanging a LINE code", async () => {
    await withApp(async (request) => {
      const start = await (await request("/api/admin/line-login")).json();
      const state = new URL(start.url).searchParams.get("state");
      expect((await request("/api/admin/line-callback", { code: "fake", state: "wrong" })).status).toBe(400);
      expect((await request("/api/admin/line-callback", { code: "fake", state })).status).toBe(400);
      expect(mocks.exchange).not.toHaveBeenCalled();
    });
  });

  it("denies an unprivileged role by default and does not register a personal login", async () => {
    mocks.byLine.mockResolvedValue([{ ...employee, role: "救生" }]);
    await withApp(async (request) => {
      expect((await lineLogin(request)).status).toBe(403);
      expect((await request("/api/admin/me")).status).toBe(401);
      expect(mocks.loginRecord).not.toHaveBeenCalled();
    });
  });

  it("rechecks role grants, activity and LINE binding instead of trusting session snapshots", async () => {
    await withApp(async (request) => {
      expect((await lineLogin(request)).status).toBe(200);
      mocks.permissions.mockResolvedValue({ permissions: ["employees:read"] });
      expect((await (await request("/api/admin/me")).json()).permissions).toEqual(["employees:read"]);
      mocks.employee.mockResolvedValue({ ...employee, status: "inactive" });
      expect((await request("/api/admin/me")).status).toBe(401);
      mocks.employee.mockResolvedValue({ ...employee, lineId: "U-rebound" });
      expect((await request("/api/admin/me")).status).toBe(401);
    });
  });

  it("refuses an ambiguous LINE account instead of selecting the first active employee", async () => {
    mocks.byLine.mockResolvedValue([employee, { ...employee, id: 8 }]);
    await withApp(async (request) => {
      expect((await lineLogin(request)).status).toBe(403);
      expect(mocks.loginRecord).not.toHaveBeenCalled();
    });
  });

  it("identifies password login as shared and revokes existing shared sessions when disabled", async () => {
    await withApp(async (request) => {
      const login = await request("/api/admin/login", { password: "test-password" });
      expect(await login.json()).toMatchObject({ authKind: "shared_password", name: "共用管理員" });
      mocks.enabled.mockResolvedValue(false);
      expect((await request("/api/admin/me")).status).toBe(401);
      expect((await request("/api/admin/login", { password: "test-password" })).status).toBe(403);
      expect((await request("/api/admin/dev-login", {})).status).toBe(401);
    });
  });

  it("treats a pre-upgrade adminId-only session as shared, and does not confuse it with the employee", async () => {
    await withApp(async (request) => {
      await request("/_old-shared", {});
      expect(await (await request("/api/admin/me")).json()).toMatchObject({ id: -1, authKind: "shared_password" });
      mocks.enabled.mockResolvedValue(false);
      expect((await request("/api/admin/me")).status).toBe(401);
      expect(mocks.employee).not.toHaveBeenCalled();
    });
  });
});
