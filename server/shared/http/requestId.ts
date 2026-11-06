import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-Id";

/** The business records a request is about, by name: `{ employeeId: 12 }`. */
export type RequestSubject = Record<string, string | number>;

export interface RequestContext {
  requestId: string;
  subject: RequestSubject;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The id of the request being served, or undefined outside one (boot, cron). */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function runInRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return runInRequestContext({ requestId, subject: {} }, fn);
}

/** Runs `fn` outside any request: work it starts in the background is not logged under, or noted on, the request that triggered it. */
export function outsideRequest<T>(fn: () => T): T {
  return storage.exit(fn);
}

/** Names the records the current request is about, so its error record can be found by them. Outside a request it does nothing. */
export function noteRequestSubject(fields: RequestSubject): void {
  const context = storage.getStore();
  if (context) Object.assign(context.subject, fields);
}

const PLAIN_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

/** Keep an id the caller sent when it is a short plain token, otherwise make one. */
export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === "string" && PLAIN_TOKEN.test(incoming) ? incoming : randomUUID();
}
