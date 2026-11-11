import { configureLogSink, recordLog } from "./collector";

export function startLogPersistence(): () => void {
  const stop = configureLogSink(async (batch) => {
    const { writeLogBatch } = await import("../../infra/logs");
    await writeLogBatch(batch);
  });
  recordLog("info", "server.started", "server.restarts");
  return stop;
}

export async function purgeOldLogs(now: Date = new Date()): Promise<number> {
  const { deleteLogsBefore } = await import("../../infra/logs");
  return deleteLogsBefore(new Date(now.getTime() - 14 * 86_400_000));
}
