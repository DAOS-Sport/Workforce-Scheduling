import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveSession, getEmployee } = vi.hoisted(() => ({ resolveSession: vi.fn(), getEmployee: vi.fn() }));
vi.mock("../../modules/admin/admin.service", () => ({ adminService: { resolveSession } }));
vi.mock("../../modules/employee/employee.service", () => ({ employeeService: { getEmployee } }));
import { gateAdminApi } from "./requireAdmin";

async function call(path: string, method = "GET", body: object = {}) {
  const req = { path, method, body, session: { adminId: 7, adminAuthKind: "personal" } } as any;
  const res = { statusCode: 200, status(n: number) { this.statusCode = n; return this; }, json: vi.fn() };
  const next = vi.fn();
  await gateAdminApi(req, res as any, next);
  return { status: next.mock.calls.length ? 200 : res.statusCode, next };
}

describe("server-side admin page/action permissions", () => {
  beforeEach(() => {
    resolveSession.mockReset();
    getEmployee.mockReset();
    getEmployee.mockResolvedValue({ id: 7, role: "救生", status: "active", isAdmin: false, lineId: "U-existing" });
    resolveSession.mockResolvedValue({
      id: 7, name: "測試員工", role: "救生", authKind: "personal", permissions: ["employees:read"],
    });
  });

  it.each(["/api/shifts/A/2026-11-01/2026-11-30", "/API/SHIFTS/A/2026-11-01/2026-11-30/", "/api//shifts/A/2026-11-01/2026-11-30", "/api/%73hifts/A/2026-11-01/2026-11-30"])("denies a forbidden read: %s", async (path) => {
    expect((await call(path)).status).toBe(403);
  });

  it("allows an authorized read and denies write with read-only permission", async () => {
    expect((await call("/api/employees/manage/A")).status).toBe(200);
    expect((await call("/api/employees/7", "PATCH", { name: "new" })).status).toBe(403);
  });

  it("requires permissions:write to change employee identity fields", async () => {
    resolveSession.mockResolvedValue({ id: 7, name: "員工", authKind: "personal", permissions: ["employees:read", "employees:write"] });
    expect((await call("/api/employees/7", "PATCH", { role: "主管職" })).status).toBe(403);
    expect((await call("/api/employees/7", "PATCH", { lineId: "U-other" })).status).toBe(403);
  });

  it("lets an employee editor change a name while sending unchanged identity fields from the existing full form", async () => {
    resolveSession.mockResolvedValue({ id: 7, name: "員工", authKind: "personal", permissions: ["employees:read", "employees:write"] });
    expect((await call("/api/employees/7", "PATCH", { name: "新名字", role: "救生", status: "active", isAdmin: false, lineId: "U-existing" })).status).toBe(200);
    expect(getEmployee).toHaveBeenCalledWith(7);
    expect((await call("/api/employees/7", "PATCH", { name: "新名字", role: "主管職", status: "active" })).status).toBe(403);
  });

  it("does not trust submitted old identity values when the target employee is missing or cannot be read", async () => {
    resolveSession.mockResolvedValue({ id: 7, name: "員工", authKind: "personal", permissions: ["employees:read", "employees:write"] });
    getEmployee.mockResolvedValue(undefined);
    expect((await call("/api/employees/7", "PATCH", { role: "救生", status: "active" })).status).toBe(404);
    getEmployee.mockRejectedValue(new Error("database unavailable"));
    expect((await call("/api/employees/7", "PATCH", { role: "救生", status: "active" })).status).toBe(503);
  });

  it.each(["/admin/summer-schedule-v40.html", "/ADMIN/SUMMER-SCHEDULE-V40.HTML/", "/admin//summer-schedule-v40.html", "/%61dmin/summer-schedule-v40.html"])("protects the static summer asset: %s", async (path) => {
    expect((await call(path)).status).toBe(403);
  });

  it("rejects an old shared session after the switch is disabled", async () => {
    resolveSession.mockRejectedValue(Object.assign(new Error("共用密碼登入已停用"), { status: 401 }));
    expect((await call("/api/employees/manage/A")).status).toBe(401);
  });

  it("does not add admin permissions to portal requests", async () => {
    expect((await call("/api/portal/my-shifts/7/2026-11-01/2026-11-30")).status).toBe(200);
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it("rejects unknown admin APIs and malformed encoding", async () => {
    expect((await call("/api/unmapped-admin-write", "POST")).status).toBe(403);
    expect((await call("/api/%ZZ")).status).toBe(400);
  });
});
