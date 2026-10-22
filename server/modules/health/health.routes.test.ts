import express from "express";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockBuild } = vi.hoisted(() => ({ mockBuild: vi.fn() }));
vi.mock("./health.service", () => ({ buildHealthReport: mockBuild }));

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
      expect(mockBuild).not.toHaveBeenCalled();
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
});
