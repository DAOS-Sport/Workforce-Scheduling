import type { AppErrorRow } from "@shared/schema";
import { errorsRepository, type ErrorFilter } from "./errors.repository";

export interface ServerErrorEntry {
  requestId: string;
  method: string;
  path: string;
  status: number;
  message: string;
  stack?: string;
}

const MAX_MESSAGE = 1000;
const MAX_PATH = 500;
const MAX_STACK_LINES = 8;
const MAX_STACK = 2000;

const pending = new Set<Promise<void>>();

/**
 * Writes one row for a server error without making the answer wait for it. A failed write is
 * logged and dropped: losing a record must never turn into a second failure for the user.
 */
export function recordServerError(entry: ServerErrorEntry): void {
  const write: Promise<void> = errorsRepository
    .insert({
      requestId: entry.requestId,
      method: entry.method,
      path: entry.path.slice(0, MAX_PATH),
      status: entry.status,
      message: entry.message.slice(0, MAX_MESSAGE),
      stack: entry.stack ? entry.stack.split("\n").slice(0, MAX_STACK_LINES).join("\n").slice(0, MAX_STACK) : null,
    })
    .catch((err: unknown) => {
      console.error("[errors] could not write the error record:", (err as { message?: string })?.message ?? err);
    })
    .finally(() => {
      pending.delete(write);
    });
  pending.add(write);
}

/** Resolves once every record write started so far has finished (tests, shutdown). */
export async function settleErrorWrites(): Promise<void> {
  await Promise.allSettled([...pending]);
}

export function listErrors(filter: ErrorFilter): Promise<AppErrorRow[]> {
  return errorsRepository.list(filter);
}
