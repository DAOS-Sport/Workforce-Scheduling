import { LOCK_NS, withSessionLock } from "../../infra/db/tx";
import { trackJob, type JobTrigger } from "./healthState";

export type JobRun<T> = { busy: false; value: T } | { busy: true };

/**
 * Runs a scheduled or manually triggered job unless another instance (or an earlier trigger) is still running
 * the same job; that caller gets `{ busy: true }` at once and leaves the job's health record alone.
 * The lock is held for the whole run, on its own connection, so the job can use the pool freely.
 */
export async function runJob<T>(
  job: string,
  trigger: JobTrigger,
  run: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>,
): Promise<JobRun<T>> {
  const locked = await withSessionLock(LOCK_NS.scheduledJob, `job:${job}`, () => trackJob(job, trigger, run, summarize));
  return locked.acquired ? { busy: false, value: locked.value } : { busy: true };
}
