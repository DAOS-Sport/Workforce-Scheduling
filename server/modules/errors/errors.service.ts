import type { AppErrorRow } from "@shared/schema";
import type { RequestSubject } from "../../shared/http/requestId";
import { errorsRepository, type ErrorFilter } from "./errors.repository";
import { purgeOldLogs } from "../../shared/logging/persistence";

export interface ServerErrorEntry {
  requestId: string;
  method: string;
  path: string;
  status: number;
  message: string;
  stack?: string;
  subject?: RequestSubject;
}

/** How long an error record is kept. */
export const ERROR_RETENTION_DAYS = 90;

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
      subject: entry.subject && Object.keys(entry.subject).length > 0 ? { ...entry.subject } : null,
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

export function oldestErrorOccurrence(): Promise<Date | null> {
  return errorsRepository.oldestOccurredAt();
}

/** Deletes the records older than the retention period. */
export async function purgeOldErrors(now: Date = new Date()): Promise<{ deleted: number }> {
  const deleted = await errorsRepository.deleteBefore(new Date(now.getTime() - ERROR_RETENTION_DAYS * 86_400_000));
  try { await purgeOldLogs(now); } catch { /* Log cleanup must not change a completed errors purge. */ }
  return { deleted };
}
