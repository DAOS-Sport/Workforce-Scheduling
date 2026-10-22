// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
const f = vi.hoisted(() => ({
  employees: [
    { id: 1, name: "Active", employeeCode: "A", role: "櫃台", employmentType: "part_time", regionId: 1, status: "active" },
    { id: 2, name: "Resigned", employeeCode: "R", role: "櫃台", employmentType: "part_time", regionId: 1, status: "inactive" },
    { id: 3, name: "Other region", employeeCode: "O", role: "櫃台", employmentType: "part_time", regionId: 2, status: "inactive" },
    { id: 4, name: "NeiQin resigned", employeeCode: "D", role: "行政專員", employmentType: "full_time", regionId: 4, status: "inactive" },
  ],
}));
vi.mock("./employee.repository", () => ({ employeeRepository: {
  getAllEmployees: vi.fn(async () => f.employees),
  getEmployeesByRegion: vi.fn(async (id: number) => f.employees.filter((e) => e.regionId === id)),
  getEmployeesForNeiQin: vi.fn(async () => f.employees.filter((e) => e.regionId === 4)),
} }));
vi.mock("../region/region.service", () => ({ regionService: {
  findByCode: vi.fn(async (c: string) => ({ A: { id: 1 }, B: { id: 2 }, D: { id: 4 } } as any)[c]),
} }));
import { mountEmployeeRoutes } from "./employee.routes";
import { gateAdminApi } from "../../shared/middleware/requireAdmin";

async function request(path: string, admin = true) {
  const app = express();
  app.use((req, _res, next) => { (req as any).session = admin ? { adminId: 1 } : {}; next(); });
  app.use(gateAdminApi); mountEmployeeRoutes(undefined as any, app);
  const server = createServer(app); await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch("http://127.0.0.1:" + (server.address() as any).port + path);
    return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
}

describe("employee management list keeps resigned employees", () => {
  it("lists active and resigned employees of the region", async () => {
    const r = await request("/api/employees/manage/A");
    expect(r.status).toBe(200);
    expect(r.body.map((e: any) => [e.id, e.status])).toEqual([[1, "active"], [2, "inactive"]]);
  });
  it("uses the NeiQin lookup for region D and de-dupes repeated codes", async () => {
    expect((await request("/api/employees/manage/D")).body.map((e: any) => e.id)).toEqual([4]);
    expect((await request("/api/employees/manage/A,B,A")).body.map((e: any) => e.id)).toEqual([1, 2, 3]);
  });
  it("leaves the shared region list active-only", async () => {
    expect((await request("/api/employees/A")).body.map((e: any) => e.id)).toEqual([1]);
  });
  it("returns nothing for an unknown region", async () => {
    expect((await request("/api/employees/manage/UNKNOWN")).body).toEqual([]);
  });
  it("requires the admin session", async () => {
    expect((await request("/api/employees/manage/A", false)).status).toBe(401);
  });
});
