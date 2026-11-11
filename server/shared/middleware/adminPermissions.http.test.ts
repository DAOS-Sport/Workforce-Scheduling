import express from "express";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_PERMISSION_KEYS } from "@shared/admin-permissions";

const mocks = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), revoke: vi.fn(), adjust: vi.fn() }));
vi.mock("../../modules/admin/admin.service", () => ({ adminService: { resolveSession: mocks.session } }));
vi.mock("../../modules/clock/clock.service", () => ({ clockService: { adminCreateRecord: mocks.create, adminUpdateRecord: mocks.update, adminDeleteRecord: mocks.remove } }));
vi.mock("../../modules/leave/leave.service", () => ({ leaveService: { revoke: mocks.revoke, adjustRequest: mocks.adjust } }));
vi.mock("../../modules/employee/employee.service", () => ({ employeeService: {} }));
import { gateAdminApi } from "./requireAdmin";
import { mountClockRecordsRoutes } from "../../modules/clock/clock.records.routes";
import { mountLeaveRoutes } from "../../modules/leave/leave.routes";

async function withApp(run: (request: (method: string, path: string) => Promise<Response>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { adminId: 7 } as any; next(); });
  app.use(gateAdminApi);
  const server = app.listen(0);
  mountClockRecordsRoutes(server, app); mountLeaveRoutes(server, app);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const request = (method: string, path: string) => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
  try { await run(request); } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

describe("actual clock CRUD and leave revoke/adjust behind the permission gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ id: 7, name: "主管", authKind: "personal", permissions: [...ADMIN_PERMISSION_KEYS] });
    for (const fn of [mocks.create, mocks.update, mocks.remove, mocks.revoke, mocks.adjust]) fn.mockResolvedValue({ id: 1 });
  });
  it("lets the full-role permissions reach all five actual mutation handlers", async () => {
    await withApp(async (request) => {
      expect((await request("POST", "/api/clock-records")).status).toBe(201);
      expect((await request("PATCH", "/api/clock-records/1")).status).toBe(200);
      expect((await request("DELETE", "/api/clock-records/1")).status).toBe(200);
      expect((await request("POST", "/api/leave-requests/1/revoke")).status).toBe(200);
      expect((await request("PATCH", "/api/leave-requests/1/adjust")).status).toBe(200);
    });
    for (const fn of [mocks.create, mocks.update, mocks.remove, mocks.revoke, mocks.adjust]) expect(fn).toHaveBeenCalledOnce();
  });
  it("blocks read-only mutation attempts including uppercase, trailing slash and encoded route forms", async () => {
    mocks.session.mockResolvedValue({ id: 7, name: "唯讀", authKind: "personal", permissions: ["clock-records:read", "leave-requests:read"] });
    await withApp(async (request) => {
      for (const [method, path] of [["POST", "/api/clock-records"], ["PATCH", "/API/CLOCK-RECORDS/1/"], ["DELETE", "/api/%63lock-records/1"], ["POST", "/api/leave-requests/1/revoke"], ["PATCH", "/api/leave-requests/1/adjust"]]) expect((await request(method, path)).status).toBe(403);
    });
    for (const fn of [mocks.create, mocks.update, mocks.remove, mocks.revoke, mocks.adjust]) expect(fn).not.toHaveBeenCalled();
  });
});
