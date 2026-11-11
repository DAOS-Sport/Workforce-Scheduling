import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../infra/db", () => ({ db: {}, pool: {} }));
import { requireMcpToken } from "./mcp.routes";

const saved = { mcp: process.env.MCP_TOKEN, internal: process.env.INTERNAL_API_TOKEN };

afterEach(() => {
  process.env.MCP_TOKEN = saved.mcp;
  process.env.INTERNAL_API_TOKEN = saved.internal;
  if (saved.mcp === undefined) delete process.env.MCP_TOKEN;
  if (saved.internal === undefined) delete process.env.INTERNAL_API_TOKEN;
});

function call(headers: Record<string, string>) {
  const req = { header: (name: string) => headers[name.toLowerCase()] } as any;
  const res = { statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  const next = vi.fn();
  requireMcpToken(req, res as any, next);
  return { status: next.mock.calls.length ? "passed" : res.statusCode, body: res.body };
}

describe("/mcp token", () => {
  it("is off (503) without MCP_TOKEN, even when the internal API token is set and sent", () => {
    delete process.env.MCP_TOKEN;
    process.env.INTERNAL_API_TOKEN = "internal-secret";
    expect(call({ authorization: "Bearer internal-secret" })).toMatchObject({ status: 503, body: { code: "MCP_DISABLED" } });
  });

  it("rejects the internal API token when MCP_TOKEN is set", () => {
    process.env.MCP_TOKEN = "mcp-secret";
    process.env.INTERNAL_API_TOKEN = "internal-secret";
    expect(call({ authorization: "Bearer internal-secret" }).status).toBe(403);
  });

  it("accepts MCP_TOKEN in each supported header", () => {
    process.env.MCP_TOKEN = "mcp-secret";
    expect(call({ authorization: "Bearer mcp-secret" }).status).toBe("passed");
    expect(call({ "x-internal-token": "mcp-secret" }).status).toBe("passed");
    expect(call({ "x-api-key": "mcp-secret" }).status).toBe("passed");
  });

  it("rejects a missing token (401), a prefix and a longer string (403)", () => {
    process.env.MCP_TOKEN = "mcp-secret";
    expect(call({}).status).toBe(401);
    expect(call({ authorization: "Bearer mcp-secre" }).status).toBe(403);
    expect(call({ authorization: "Bearer mcp-secret-and-more" }).status).toBe(403);
  });
});
