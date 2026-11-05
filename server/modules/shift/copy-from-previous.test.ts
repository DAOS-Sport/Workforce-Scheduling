// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createServer } from "node:http";

const f = vi.hoisted(() => ({
  employees: [
    { id: 1, regionId: 1, status: "active" },
    { id: 2, regionId: 1, status: "inactive" },
  ],
  previous: [
    { id: 10, employeeId: 1, venueId: 5, date: "2026-10-05", startTime: "09:00:00", endTime: "17:00:00", role: "救生", isDispatch: false, dispatchCompany: null, dispatchName: null, dispatchPhone: null },
    { id: 11, employeeId: 2, venueId: 5, date: "2026-10-06", startTime: "09:00:00", endTime: "17:00:00", role: "救生", isDispatch: false, dispatchCompany: null, dispatchName: null, dispatchPhone: null },
  ],
  created: [] as any[],
}));

const mockData = vi.hoisted(() => ({
  getRegionByCode: vi.fn(async (code: string) => (code === "A" ? { id: 1, code: "A" } : undefined)),
  getEmployeesByRegion: vi.fn(async () => f.employees),
  getShiftsByRegionAndDateRange: vi.fn(async (_regionId: number, start: string) => (start.startsWith("2026-10") ? f.previous : [])),
  createShift: vi.fn(async (data: any, actor: string) => {
    const row = { id: 1000 + f.created.length, ...data, actor };
    f.created.push(row);
    return row;
  }),
}));

vi.mock("../../infra/db/tx", () => ({
  LOCK_NS: { shiftLabor: 103, shiftRegionMonth: 104 },
  lockXact: vi.fn(async () => undefined),
  lockXactAscending: vi.fn(async () => undefined),
  withTx: (fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("../employee/employee.repository", () => ({ employeeRepository: mockData }));
vi.mock("../region/region.repository", () => ({ regionRepository: mockData }));
vi.mock("./shift.repository", () => ({ shiftRepository: mockData }));

import { mountShiftRoutes } from "./shift.routes";

async function copyInto(targetMonth: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { adminId: 1, adminName: "tester" }; next(); });
  mountShiftRoutes(app);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch("http://127.0.0.1:" + (server.address() as any).port + "/api/shifts/copy-from-previous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regionCode: "A", targetYear: 2026, targetMonth }),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("copy schedule from the previous month", () => {
  beforeEach(() => { f.created.length = 0; });

  it("does not carry a resigned employee's shifts into the new month", async () => {
    const r = await copyInto(11);
    expect(r.status).toBe(200);
    expect(f.created.map((s) => s.employeeId)).toEqual([1]);
    expect(f.created[0].date).toBe("2026-11-05");
    expect(r.body.created).toBe(1);
    expect(r.body.skippedInactive).toBe(1);
    expect(r.body.message).toContain("略過離職人員 1 筆");
  });

  it("copies everything and adds no note when nobody has resigned", async () => {
    f.employees[1].status = "active";
    try {
      const r = await copyInto(11);
      expect(f.created.map((s) => s.employeeId)).toEqual([1, 2]);
      expect(r.body.created).toBe(2);
      expect(r.body.skippedInactive).toBe(0);
      expect(r.body.message).toBe("已從10月複製 2 筆班表");
    } finally {
      f.employees[1].status = "inactive";
    }
  });
});
