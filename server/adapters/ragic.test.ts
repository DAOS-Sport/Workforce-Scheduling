import http from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";

const { recordIntegration } = vi.hoisted(() => ({ recordIntegration: vi.fn() }));
vi.mock("../shared/health/healthState", () => ({ recordIntegration }));

import { fetchAllRagicRecords, fetchH02RagicRecords, RagicHttpError } from "./ragic";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void;
const open: http.Server[] = [];

async function fakeRagic(handler: Handler): Promise<{ url: string; calls: () => number }> {
  let n = 0;
  const server = http.createServer((req, res) => handler(req, res, ++n));
  open.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/ragic`, calls: () => n };
}

const fast = { attemptTimeoutMs: 150, maxRetries: 3, backoffMs: () => 10, pageDelayMs: 0 };

it("reads the H02 employee sheet through the existing v3 adapter", async () => {
  const records = { "81": { 員工編號: "H02-FIX-001", 應徵職務: ["主管職", "行政專員"] } };
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(records), { status: 200 }));
  try {
    expect(await fetchH02RagicRecords("fixture-key")).toEqual(records);
    expect(request).toHaveBeenCalledTimes(1);
    const url = new URL(String(request.mock.calls[0][0]));
    expect([url.origin, url.pathname, url.searchParams.get("v")]).toEqual(["https://ap7.ragic.com", "/xinsheng/ragicforms4/13", "3"]);
  } finally {
    request.mockRestore();
  }
});

afterEach(async () => {
  for (const s of open.splice(0)) {
    s.closeAllConnections?.();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  recordIntegration.mockClear();
});

describe("Ragic adapter timeouts and retries (GitHub #1)", () => {
  it("gives up after the retry budget when Ragic never sends headers", async () => {
    const ragic = await fakeRagic(() => {});
    const t0 = Date.now();
    const err = await fetchAllRagicRecords("k", { ...fast, baseUrl: ragic.url }).catch((e) => e);
    expect(err?.name).toBe("TimeoutError");
    expect(ragic.calls()).toBe(3);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(recordIntegration).toHaveBeenCalledWith("ragic", false, err);
  });

  it("times out when headers arrive but the body stalls", async () => {
    const ragic = await fakeRagic((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"1": {');
    });
    const err = await fetchAllRagicRecords("k", { ...fast, baseUrl: ragic.url }).catch((e) => e);
    expect(err?.name).toBe("TimeoutError");
    expect(ragic.calls()).toBe(3);
  });

  it("does not retry a 401", async () => {
    const ragic = await fakeRagic((_req, res) => {
      res.writeHead(401);
      res.end();
    });
    const err = await fetchAllRagicRecords("k", { ...fast, baseUrl: ragic.url }).catch((e) => e);
    expect(err).toBeInstanceOf(RagicHttpError);
    expect((err as RagicHttpError).status).toBe(401);
    expect(ragic.calls()).toBe(1);
  });

  it("retries a 503 and succeeds once Ragic recovers", async () => {
    const ragic = await fakeRagic((_req, res, n) => {
      if (n === 1) {
        res.writeHead(503);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ "1": { name: "A" }, "2": { name: "B" }, "@meta": {} }));
    });
    const records = await fetchAllRagicRecords("k", { ...fast, baseUrl: ragic.url });
    expect(Object.keys(records)).toEqual(["1", "2"]);
    expect(ragic.calls()).toBe(2);
    expect(recordIntegration).toHaveBeenLastCalledWith("ragic", true);
  });

  it("sends the API key and the same query as before", async () => {
    let seen: http.IncomingMessage | null = null;
    const ragic = await fakeRagic((req, res) => {
      seen = req;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await fetchAllRagicRecords("secret-key", { ...fast, baseUrl: ragic.url });
    const url = new URL(seen!.url!, "http://x");
    expect(seen!.headers.authorization).toBe("Basic secret-key");
    expect([url.searchParams.get("v"), url.searchParams.get("limit"), url.searchParams.get("offset")]).toEqual(["3", "1000", "0"]);
  });
});
