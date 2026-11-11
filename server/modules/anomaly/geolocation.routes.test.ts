import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";

const { create, recordLog } = vi.hoisted(() => ({ create: vi.fn(), recordLog: vi.fn() }));
vi.mock("./anomaly.service", () => ({ anomalyService: { create } }));
vi.mock("../../shared/logging/collector", () => ({ recordLog }));
import { mountAnomalyRoutes } from "./anomaly.routes";

const valid = { event: "geolocation_failure", kind: "TIMEOUT", entry: "liff", platform: "iOS", inLine: true };

async function withApp(run: (post: (body: unknown) => Promise<Response>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  mountAnomalyRoutes({} as Server, app);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(body => fetch(`http://127.0.0.1:${port}/api/anomaly-report`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

afterEach(() => vi.resetAllMocks());

describe("geolocation failure telemetry on the existing anomaly endpoint", () => {
  it.each(["PERMISSION_DENIED", "POSITION_UNAVAILABLE", "TIMEOUT", "UNSUPPORTED", "INSECURE_CONTEXT", "POOR_ACCURACY", "UNKNOWN"])("records only allowed metadata for %s without creating an employee report", async kind => {
    await withApp(async post => {
      const response = await post({ ...valid, kind });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(create).not.toHaveBeenCalled();
      expect(recordLog).toHaveBeenCalledExactlyOnceWith("warn", `geolocation_failure ${JSON.stringify({ kind, entry: "liff", platform: "iOS", inLine: true })}`, "clock.coverage");
    });
  });

  it.each(["iOS", "Android", "other"])("accepts portal and a non-LINE browser on %s", async platform => {
    await withApp(async post => {
      expect((await post({ ...valid, entry: "portal", platform, inLine: false })).status).toBe(200);
      const metadata = JSON.parse(recordLog.mock.calls[0][1].slice("geolocation_failure ".length));
      expect(metadata).toEqual({ kind: "TIMEOUT", entry: "portal", platform, inLine: false });
    });
  });

  it("rejects invalid, missing and extra fields without logging the request", async () => {
    const invalid = [
      { ...valid, kind: "private error message" }, { ...valid, kind: null },
      { ...valid, entry: "admin" }, { ...valid, platform: "raw browser user-agent" },
      { ...valid, inLine: "true" }, { ...valid, inLine: 1 },
      { ...valid, latitude: 25.01 }, { ...valid, employeeId: 901 },
      { ...valid, name: "synthetic private name" }, { ...valid, userAgent: "raw ua" },
      ...["kind", "entry", "platform", "inLine"].map(key => Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key))),
    ];
    await withApp(async post => {
      for (const body of invalid) {
        const response = await post(body);
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(await response.json()).toEqual({ message: "定位失敗回報格式不正確" });
      }
      expect(recordLog).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });

  it("retains the existing employee anomaly-report behavior", async () => {
    create.mockResolvedValue({ record: { id: 73, createdAt: "2026-11-11T00:00:00Z" }, reportText: "synthetic report" });
    await withApp(async post => {
      const response = await post({ employee: { name: "synthetic" }, userNote: "synthetic note" });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ id: 73, reportText: "synthetic report", imageUrls: [] });
      expect(create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ employee: { name: "synthetic" }, userNote: "synthetic note" }));
      expect(recordLog).not.toHaveBeenCalled();
    });
  });
});
