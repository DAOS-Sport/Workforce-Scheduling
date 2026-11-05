import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-Id";

const storage = new AsyncLocalStorage<string>();

/** The id of the request being served, or undefined outside one (boot, cron). */
export function currentRequestId(): string | undefined {
  return storage.getStore();
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run(requestId, fn);
}

const PLAIN_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

/** Keep an id the caller sent when it is a short plain token, otherwise make one. */
export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === "string" && PLAIN_TOKEN.test(incoming) ? incoming : randomUUID();
}
