import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunRagicSync, mockRunVenueSync, mockAcceptWebhook } = vi.hoisted(() => ({
  mockRunRagicSync: vi.fn(),
  mockRunVenueSync: vi.fn(),
  mockAcceptWebhook: vi.fn(),
}));

vi.mock("./ragic.service", () => ({
  runRagicSync: mockRunRagicSync,
  runVenueSync: mockRunVenueSync,
  acceptWebhook: mockAcceptWebhook,
}));
vi.mock("../../shared/health/healthState", () => ({
  trackJob: async (_job: string, _trigger: string, run: () => Promise<unknown>) => run(),
}));

import { mountRagicRoutes } from "./ragic.routes";

async function withRagicApp(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  mountRagicRoutes(server as Server, app);

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

const SYNC_RESULT = { created: 1, updated: 2, skipped: 3, deactivated: 4, errors: [], skipReasons: {}, totalFetched: 10 };

describe("Ragic H01 webhook route", () => {
  beforeEach(() => {
    process.env.RAGIC_WEBHOOK_SECRET = "test-webhook-secret";
    mockAcceptWebhook.mockResolvedValue({ eventId: "evt-1", duplicate: false });
  });

  afterEach(() => {
    delete process.env.RAGIC_WEBHOOK_SECRET;
    vi.clearAllMocks();
  });

  it("rejects H01 webhook calls with a wrong secret", async () => {
    await withRagicApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ragic/webhook/h01?secret=wrong`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([1, 2, 3]),
      });

      expect(res.status).toBe(403);
      expect(mockAcceptWebhook).not.toHaveBeenCalled();
    });
  });

  it("stores the delivery and answers 202 without running the sync itself", async () => {
    await withRagicApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ragic/webhook/h01`, {
        method: "POST",
        headers: { "x-ragic-webhook-secret": "test-webhook-secret", "x-ragic-event-id": "evt-1" },
      });
      const body = await res.json();

      expect(res.status).toBe(202);
      expect(body).toEqual({ message: "H01 webhook accepted", eventId: "evt-1", duplicate: false });
      expect(mockAcceptWebhook).toHaveBeenCalledWith("evt-1");
      expect(mockRunRagicSync).not.toHaveBeenCalled();
    });
  });

  it("accepts the secret in the query string, and a body the JSON parser does not understand", async () => {
    await withRagicApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ragic/webhook/h01?secret=test-webhook-secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json; utf-8" },
        body: JSON.stringify({ ragicId: 1 }),
      });

      expect(res.status).toBe(202);
      expect(mockAcceptWebhook).toHaveBeenCalledWith(undefined);
    });
  });
});

describe("Ragic manual sync routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns the sync result, on both URLs", async () => {
    mockRunRagicSync.mockResolvedValue({ busy: false, result: SYNC_RESULT });
    await withRagicApp(async (baseUrl) => {
      for (const path of ["/api/ragic-sync", "/api/ragic/sync-employees"]) {
        const res = await fetch(`${baseUrl}${path}`, { method: "POST" });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(SYNC_RESULT);
      }
      expect(mockRunRagicSync).toHaveBeenCalledWith("manual");
    });
  });

  it("answers 202 when another sync holds the lock", async () => {
    mockRunRagicSync.mockResolvedValue({ busy: true });
    mockRunVenueSync.mockResolvedValue({ busy: true });
    await withRagicApp(async (baseUrl) => {
      for (const path of ["/api/ragic-sync", "/api/ragic/sync-employees", "/api/ragic-venue-sync", "/api/ragic/sync-venues"]) {
        const res = await fetch(`${baseUrl}${path}`, { method: "POST" });
        expect(res.status).toBe(202);
        expect((await res.json()).status).toBe("busy");
      }
    });
  });

  it("answers with the status of a refused snapshot", async () => {
    mockRunRagicSync.mockRejectedValue(Object.assign(new Error("Ragic 回傳 0 筆有員工編號的記錄"), { status: 409 }));
    await withRagicApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ragic-sync`, { method: "POST" });

      expect(res.status).toBe(409);
      expect((await res.json()).message).toContain("0 筆");
    });
  });
});
