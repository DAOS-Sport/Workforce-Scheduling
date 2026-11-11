import express from "express";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockBuild, mockLogs } = vi.hoisted(() => ({ mockBuild: vi.fn(), mockLogs: vi.fn() }));
vi.mock("./health.service", () => ({ buildHealthReport: mockBuild }));
vi.mock("../../infra/db", () => ({ db: { execute: vi.fn() } }));
vi.mock("./healthLogs", async (importOriginal) => ({ ...(await importOriginal<object>()), queryHealthLogs: mockLogs }));

import { gateAdminApi } from "../../shared/middleware/requireAdmin";
import { mountHealthRoutes } from "./health.routes";

async function withApp(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  mountHealthRoutes(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("GET /api/health/pipelines", () => {
  // 開發區與正式站的環境本來就有 HEALTH_TOKEN，每個測試都要從沒設定的狀態開始。
  beforeEach(() => {
    delete process.env.HEALTH_TOKEN;
  });

  afterEach(() => {
    delete process.env.HEALTH_TOKEN;
    vi.clearAllMocks();
  });

  it("503 when HEALTH_TOKEN is not configured", async () => {
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/pipelines`, { headers: { Authorization: "Bearer anything" } });
      expect(res.status).toBe(503);
      expect((await fetch(`${base}/api/health/logs`, { headers: { Authorization: "Bearer anything" } })).status).toBe(503);
      expect(mockBuild).not.toHaveBeenCalled();
      expect(mockLogs).not.toHaveBeenCalled();
    });
  });

  it("401 for a missing or wrong token", async () => {
    process.env.HEALTH_TOKEN = "right-token";
    await withApp(async (base) => {
      expect((await fetch(`${base}/api/health/pipelines`)).status).toBe(401);
      expect((await fetch(`${base}/api/health/pipelines`, { headers: { Authorization: "Bearer wrong-token" } })).status).toBe(401);
      expect((await fetch(`${base}/api/health/pipelines`, { headers: { Authorization: "right-token" } })).status).toBe(401);
      expect(mockBuild).not.toHaveBeenCalled();
    });
  });

  it("200 with the report for the right token, never cached", async () => {
    process.env.HEALTH_TOKEN = "right-token";
    mockBuild.mockResolvedValue({ system: "workforce-scheduling", build: "t", checkedAt: "2026-10-21T00:00:00.000Z", overall: "green", pipelines: [] });
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/pipelines`, { headers: { Authorization: "Bearer right-token" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await res.json()).system).toBe("workforce-scheduling");
    });
  });

  it("a configured value with stray spaces or a newline still matches; only spaces counts as not configured", async () => {
    process.env.HEALTH_TOKEN = "  right-token\n";
    mockBuild.mockResolvedValue({ system: "workforce-scheduling", build: "t", checkedAt: "2026-10-21T00:00:00.000Z", overall: "green", pipelines: [] });
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/pipelines`, { headers: { Authorization: "Bearer right-token" } });
      expect(res.status).toBe(200);
    });
    process.env.HEALTH_TOKEN = "   ";
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/pipelines`, { headers: { Authorization: "Bearer right-token" } });
      expect(res.status).toBe(503);
    });
  });

  it("protects logs with the same token and returns a non-cached page", async () => {
    process.env.HEALTH_TOKEN = "right-token";
    mockLogs.mockResolvedValue({ logs: [], nextCursor: null });
    await withApp(async (base) => {
      expect((await fetch(`${base}/api/health/logs`)).status).toBe(401);
      const res = await fetch(`${base}/api/health/logs?pipeline=future.job&since=2026-11-01T00:00:00Z&level=warn&limit=10`, { headers: { Authorization: "Bearer right-token" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ logs: [], nextCursor: null });
      expect(mockLogs).toHaveBeenCalledWith(expect.objectContaining({ pipeline: "future.job", level: "warn", limit: 10 }));
    });
  });

  it("rejects invalid and repeated log filters before querying", async () => {
    process.env.HEALTH_TOKEN = "right-token";
    await withApp(async (base) => {
      for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=1x", "limit=", "level=debug", "since=2026-02-30T00:00:00Z", "since=yesterday", "since=2026-01-01", "cursor=garbage", "level=warn&level=error"]) {
        const res = await fetch(`${base}/api/health/logs?${query}`, { headers: { Authorization: "Bearer right-token" } });
        expect([query, res.status]).toEqual([query, 400]);
      }
      expect(mockLogs).not.toHaveBeenCalled();
    });
  });

  it("does not expose database errors from the log endpoint", async () => {
    process.env.HEALTH_TOKEN = "right-token";
    mockLogs.mockRejectedValue(new Error("postgres://private:password@10.0.0.1/logs"));
    await withApp(async (base) => {
      const res = await fetch(`${base}/api/health/logs`, { headers: { Authorization: "Bearer right-token" } });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ message: "無法讀取日誌" });
    });
  });
});

describe("GET /api/admin/health", () => {
  const report = {
    system: "workforce-scheduling",
    build: "t",
    checkedAt: "2026-11-03T00:00:00.000Z",
    overall: "yellow",
    pipelines: [
      { id: "database", name: "資料庫", level: "green", reason: "查詢正常（< 500 ms）", lastSuccessAt: null, lastFailureAt: null, source: "select 1" },
      { id: "integration.line", name: "LINE 推播與回覆", level: "yellow", reason: "最近一次失敗", lastSuccessAt: "2026-11-02T00:00:00.000Z", lastFailureAt: "2026-11-02T01:00:00.000Z", source: "health:integration:line" },
    ],
  };

  // 不登入的測試要證明「全域後台閘門」本身就擋得住，所以掛上真的 gateAdminApi，不只靠路由自己的檢查。
  async function withAdminApp(session: Record<string, unknown>, run: (baseUrl: string) => Promise<void>, gate = true): Promise<void> {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).session = session;
      next();
    });
    if (gate) app.use(gateAdminApi);
    mountHealthRoutes(app);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  beforeEach(() => {
    delete process.env.HEALTH_TOKEN;
  });

  afterEach(() => {
    delete process.env.HEALTH_TOKEN;
    vi.clearAllMocks();
  });

  it("401 without an admin session, in any letter case, and never builds a report", async () => {
    await withAdminApp({}, async (base) => {
      for (const path of ["/api/admin/health", "/API/ADMIN/health"]) {
        const res = await fetch(base + path);
        expect([path, res.status]).toEqual([path, 401]);
      }
      expect(mockBuild).not.toHaveBeenCalled();
    });
  });

  it("the route refuses a missing session by itself, even if the global gate were not mounted", async () => {
    await withAdminApp({}, async (base) => {
      expect((await fetch(`${base}/api/admin/health`)).status).toBe(401);
      expect(mockBuild).not.toHaveBeenCalled();
    }, false);
  });

  it("a health token is not an admin login", async () => {
    process.env.HEALTH_TOKEN = "right-token";
    await withAdminApp({}, async (base) => {
      const res = await fetch(`${base}/api/admin/health`, { headers: { Authorization: "Bearer right-token" } });
      expect(res.status).toBe(401);
      expect(mockBuild).not.toHaveBeenCalled();
    });
  });

  it("200 with exactly the report the health service builds, never cached, no health token needed", async () => {
    mockBuild.mockResolvedValue(report);
    await withAdminApp({ adminId: 1 }, async (base) => {
      const res = await fetch(`${base}/api/admin/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual(report);
      expect(mockBuild).toHaveBeenCalledTimes(1);
    });
  });

  it("returns the same body as the token endpoint for the same report", async () => {
    process.env.HEALTH_TOKEN = "right-token";
    mockBuild.mockResolvedValue(report);
    await withAdminApp({ adminId: 1 }, async (base) => {
      const viaAdmin = await (await fetch(`${base}/api/admin/health`)).json();
      const viaToken = await (await fetch(`${base}/api/health/pipelines`, { headers: { Authorization: "Bearer right-token" } })).json();
      expect(viaAdmin).toEqual(viaToken);
    });
  });

  it("500 with a fixed message when the report cannot be built, without echoing the error text", async () => {
    mockBuild.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    await withAdminApp({ adminId: 1 }, async (base) => {
      const res = await fetch(`${base}/api/admin/health`);
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain("ECONNREFUSED");
    });
  });

  it("requires admin login for logs even with a health token, and queries the same service after login", async () => {
    process.env.HEALTH_TOKEN = "right-token";
    mockLogs.mockResolvedValue({ logs: [], nextCursor: null });
    await withAdminApp({}, async (base) => {
      const res = await fetch(`${base}/api/admin/health/logs`, { headers: { Authorization: "Bearer right-token" } });
      expect(res.status).toBe(401);
      expect(mockLogs).not.toHaveBeenCalled();
    }, false);
    await withAdminApp({ adminId: 1 }, async (base) => {
      const res = await fetch(`${base}/api/admin/health/logs?level=error`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ logs: [], nextCursor: null });
      expect(mockLogs).toHaveBeenCalledWith(expect.objectContaining({ level: "error" }));
    });
  });
});
