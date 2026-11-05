import net from "node:net";
import { afterAll, beforeAll } from "vitest";
import { pool } from "../infra/db";
import { assertLocalDatabaseUrl, assertRealParallelConnections, resetDatabase } from "./itest";

// Business code may push to LINE, mail, or call Ragic. Nothing in an integration
// test may leave this machine, so refuse every non-loopback socket and fetch.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"]);

function connectHost(args: unknown[]): string | null {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    const opts = first as { path?: string; host?: string };
    return opts.path ? null : opts.host ?? "localhost";
  }
  if (typeof first === "string" && Number.isNaN(Number(first))) return null;
  return typeof args[1] === "string" ? args[1] : "localhost";
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const host = connectHost(args);
  if (host !== null && !LOOPBACK.has(host)) {
    const err = Object.assign(new Error(`itest: outbound connection blocked to ${host}`), { code: "ECONNREFUSED" });
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  if (!LOOPBACK.has(host)) throw Object.assign(new TypeError(`itest: fetch blocked to ${host}`), { code: "ECONNREFUSED" });
  return originalFetch(input, init);
};

beforeAll(async () => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
  await assertRealParallelConnections();
  await resetDatabase();
});

afterAll(async () => {
  await pool.end();
});
