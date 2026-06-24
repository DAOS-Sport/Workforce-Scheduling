import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSyncFromRagic, mockSyncVenuesFromRagic } = vi.hoisted(() => ({
  mockSyncFromRagic: vi.fn(),
  mockSyncVenuesFromRagic: vi.fn(),
}));

vi.mock("./ragic.service", () => ({
  syncFromRagic: mockSyncFromRagic,
  syncVenuesFromRagic: mockSyncVenuesFromRagic,
}));

import { mountRagicRoutes } from "./ragic.routes";

async function withRagicApp(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
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

describe("Ragic H01 webhook route", () => {
  beforeEach(() => {
    process.env.RAGIC_WEBHOOK_SECRET = "test-webhook-secret";
    mockSyncFromRagic.mockResolvedValue({
      created: 1,
      updated: 2,
      skipped: 3,
      deactivated: 4,
      errors: [],
      skipReasons: {},
      totalFetched: 10,
    });
    mockSyncVenuesFromRagic.mockResolvedValue({});
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
      expect(mockSyncFromRagic).not.toHaveBeenCalled();
    });
  });

  it("runs a full H01 employee sync when the webhook secret matches", async () => {
    await withRagicApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ragic/webhook/h01`, {
        method: "POST",
        headers: { "x-ragic-webhook-secret": "test-webhook-secret" },
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(mockSyncFromRagic).toHaveBeenCalledTimes(1);
      expect(body.message).toBe("H01 webhook sync completed");
      expect(body.result).toEqual(expect.objectContaining({ totalFetched: 10 }));
    });
  });
});
