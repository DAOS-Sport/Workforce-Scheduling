import express, { type Express } from "express";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { record } = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("../../modules/errors/errors.service", () => ({ recordServerError: record }));

import { httpError } from "../errors";
import { fail } from "./response";
import { globalErrorHandler, requestContext, genericErrorMessage } from "./errorHandler";

class UpstreamError extends Error {
  constructor(public status: number) {
    super("upstream said no");
  }
}

function buildApp(withContext = true): Express {
  const app = express();
  if (withContext) app.use(requestContext);
  app.use(express.json());
  app.get("/ok", (_req, res) => void res.json({ fine: true }));
  app.get("/http-400", () => {
    throw httpError(400, "請填寫姓名", { code: "NAME_REQUIRED" });
  });
  app.get("/http-500", () => {
    throw httpError(500, "LINE Login 尚未設定");
  });
  app.get("/boom", async () => {
    throw new Error('relation "employees" does not exist');
  });
  app.get("/upstream", async () => {
    throw new UpstreamError(404);
  });
  app.get("/caught-by-route", (_req, res) => {
    try {
      throw new Error("connection to 10.0.0.5 refused");
    } catch (err: any) {
      fail(res, err.status || 500, err.message);
    }
  });
  app.get("/caught-4xx", (_req, res) => {
    fail(res, 404, "找不到資料");
  });
  app.get("/json-rpc-failure", (_req, res) => {
    res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  });
  app.get("/array-4xx", (_req, res) => {
    res.status(400).json([{ field: "name" }]);
  });
  app.post("/echo", (req, res) => void res.json(req.body));
  app.use(globalErrorHandler);
  return app;
}

async function call(app: Express, path: string, init?: RequestInit) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
    return { status: res.status, header: res.headers.get("x-request-id"), body: (await res.json()) as Record<string, any> };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  record.mockReset();
});

describe("request id", () => {
  it("is generated when the caller sends none, and is the same in the header and the 5xx body", async () => {
    const res = await call(buildApp(), "/boom");
    expect(res.header).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    expect(res.body.requestId).toBe(res.header);
  });

  it("is kept when the caller sends a well-formed one", async () => {
    const res = await call(buildApp(), "/ok", { headers: { "X-Request-Id": "front-end.abc_123" } });
    expect(res.header).toBe("front-end.abc_123");
  });

  it("is replaced when the caller's value is not a plain token", async () => {
    for (const bad of ["has space", "x".repeat(200), "a<script>"]) {
      const res = await call(buildApp(), "/ok", { headers: { "X-Request-Id": bad } });
      expect(res.header).not.toBe(bad);
      expect(res.header).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    }
  });

  it("is still present when the handler runs without the context middleware", async () => {
    const res = await call(buildApp(false), "/boom");
    expect(res.header).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    expect(res.body.requestId).toBe(res.header);
  });
});

describe("4xx answers", () => {
  // The admin and staff pages show a 4xx body's raw text in their toasts, so 4xx bodies stay exactly as the route wrote them; the id travels in the header.
  it("keep their body unchanged, carry the request id in the header only, and are not recorded", async () => {
    const res = await call(buildApp(), "/http-400");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "請填寫姓名", code: "NAME_REQUIRED" });
    expect(res.header).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    expect(record).not.toHaveBeenCalled();
  });

  it("from a route's own fail() keep their body unchanged and are not recorded", async () => {
    const res = await call(buildApp(), "/caught-4xx");
    expect(res.body).toEqual({ message: "找不到資料" });
    expect(record).not.toHaveBeenCalled();
  });

  it("include a malformed JSON body, which stays a 400", async () => {
    const res = await call(buildApp(), "/echo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
    expect(res.body.requestId).toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });
});

describe("5xx answers", () => {
  it("an unexpected error is a 500 with a generic message and the request id; its text goes to the record, not the client", async () => {
    const res = await call(buildApp(), "/boom?token=abc");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: genericErrorMessage(res.header!), requestId: res.header });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      requestId: res.header,
      method: "GET",
      path: "/boom",
      status: 500,
      message: 'relation "employees" does not exist',
    });
    expect(record.mock.calls[0][0].stack).toContain("Error");
  });

  it("an error that merely carries a status of its own (an upstream's 404) is still a 500", async () => {
    const res = await call(buildApp(), "/upstream");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe(genericErrorMessage(res.header!));
  });

  it("an httpError with a 5xx status gets the generic message too, and its own text is recorded", async () => {
    const res = await call(buildApp(), "/http-500");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe(genericErrorMessage(res.header!));
    expect(record.mock.calls[0][0].message).toBe("LINE Login 尚未設定");
  });

  it("an error a route caught and answered with its own message is recorded once and hidden from the client", async () => {
    const res = await call(buildApp(), "/caught-by-route");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: genericErrorMessage(res.header!), requestId: res.header });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ status: 500, message: "connection to 10.0.0.5 refused" });
  });

  it("a 5xx body that is not a message (a JSON-RPC error) keeps its shape and is still recorded", async () => {
    const res = await call(buildApp(), "/json-rpc-failure");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    expect(res.header).toBeTruthy();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ status: 500, message: "Internal server error" });
  });

  it("an array body is passed through as it is", async () => {
    const server = buildApp();
    const res = await call(server, "/array-4xx");
    expect(res.body).toEqual([{ field: "name" }]);
    expect(res.header).toBeTruthy();
  });

  it("is still answered when writing the record throws", async () => {
    record.mockImplementation(() => {
      throw new Error("record is broken");
    });
    const res = await call(buildApp(), "/boom");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe(genericErrorMessage(res.header!));
  });
});
