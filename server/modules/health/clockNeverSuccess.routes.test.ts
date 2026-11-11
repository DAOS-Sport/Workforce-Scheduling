import express from "express";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockBuild, mockReadEmployees } = vi.hoisted(() => ({
  mockBuild: vi.fn(),
  mockReadEmployees: vi.fn(),
}));
vi.mock("./health.service", () => ({
  buildHealthReport: mockBuild,
  readClockNeverSuccessEmployees: mockReadEmployees,
}));

import { gateAdminApi } from "../../shared/middleware/requireAdmin";
import { mountHealthRoutes } from "./health.routes";

async function withAdminApp(
  session: Record<string, unknown>,
  run: (baseUrl: string) => Promise<void>,
  gate = true,
): Promise<void> {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  if (gate) app.use(gateAdminApi);
  mountHealthRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("GET /api/admin/health/clock-never-success", () => {
  const path = "/api/admin/health/clock-never-success";

  beforeEach(() => {
    vi.stubEnv("HEALTH_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("rejects an unauthenticated request through the real admin gate", async () => {
    await withAdminApp({}, async (base) => {
      for (const requestPath of [path, path.toUpperCase()]) {
        const res = await fetch(base + requestPath);
        expect([requestPath, res.status]).toEqual([requestPath, 401]);
      }
      expect(mockReadEmployees).not.toHaveBeenCalled();
    });
  });

  it("requires an admin session even without the global gate", async () => {
    await withAdminApp({}, async (base) => {
      expect((await fetch(base + path)).status).toBe(401);
      expect(mockReadEmployees).not.toHaveBeenCalled();
    }, false);
  });

  it("does not accept a health token as an admin login", async () => {
    vi.stubEnv("HEALTH_TOKEN", "synthetic-health-token");
    await withAdminApp({}, async (base) => {
      const res = await fetch(base + path, { headers: { Authorization: "Bearer synthetic-health-token" } });
      expect(res.status).toBe(401);
      expect(mockReadEmployees).not.toHaveBeenCalled();
    });
  });

  it("returns the exact employee list, including a null last attempt, without caching", async () => {
    const employees = [
      { id: 701, name: "虛構員工甲", shiftCount7Days: 4, shiftCount14Days: 6, lastAttemptAt: "2026-11-10T01:00:00.000Z" },
      { id: 702, name: "虛構員工乙", shiftCount7Days: 3, shiftCount14Days: 5, lastAttemptAt: null },
    ];
    mockReadEmployees.mockResolvedValue(employees);
    await withAdminApp({ adminId: 1 }, async (base) => {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual(employees);
      expect(mockReadEmployees).toHaveBeenCalledExactlyOnceWith(expect.any(Date));
    });
  });

  it("returns an empty array for an authenticated admin when nobody qualifies", async () => {
    mockReadEmployees.mockResolvedValue([]);
    await withAdminApp({ adminId: 1 }, async (base) => {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual([]);
    });
  });

  it("returns a fixed error body without exposing the service error, and never caches it", async () => {
    mockReadEmployees.mockRejectedValue(new Error("synthetic database failure: private-query-detail"));
    await withAdminApp({ adminId: 1 }, async (base) => {
      const res = await fetch(base + path);
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ message: "無法取得從未成功打卡名單" });
    });
  });
});
