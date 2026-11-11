import express from "express";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveSession: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("../../modules/admin/admin.service", () => ({ adminService: { resolveSession: mocks.resolveSession } }));
vi.mock("../../modules/employee/employee.service", () => ({ employeeService: { update: mocks.update, remove: mocks.remove } }));
import { canonicalAdminPath } from "@shared/admin-permissions";
import { gateAdminApi } from "./requireAdmin";
import { mountEmployeeRoutes } from "../../modules/employee/employee.routes";

async function request(loggedIn: boolean, method: string, path: string): Promise<number> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = (loggedIn ? { adminId: 7 } : {}) as any; next(); });
  app.use(gateAdminApi);
  const server = app.listen(0);
  mountEmployeeRoutes(server, app);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method, headers: { "Content-Type": "application/json" },
      body: method === "PATCH" ? JSON.stringify({ role: "主管職", isAdmin: true }) : undefined,
    });
    await response.arrayBuffer();
    return response.status;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("encoded separators at the actual employee routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSession.mockResolvedValue({ id: 7, name: "測試帳號", authKind: "personal", permissions: ["schedule:read", "schedule:write"] });
    mocks.update.mockResolvedValue({ id: 1 });
    mocks.remove.mockResolvedValue(true);
  });

  it("requires login for the ordinary DELETE", async () => {
    expect(await request(false, "DELETE", "/api/employees/1")).toBe(401);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(["%2F", "%2f", "%5C"])("rejects an unauthenticated DELETE containing %s", async (separator) => {
    expect(await request(false, "DELETE", `/api/employees/1${separator}..${separator}..${separator}portal${separator}x`)).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(["%2F", "%2f", "%5C"])("rejects a schedule editor's employee PATCH containing %s", async (separator) => {
    expect(await request(true, "PATCH", `/api/employees/1${separator}..${separator}..${separator}shifts${separator}1`)).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps parent segments in the authorization path", () => {
    expect(canonicalAdminPath("/api/employees/1/../../shifts/1")).toBe("/api/employees/1/../../shifts/1");
  });
});
