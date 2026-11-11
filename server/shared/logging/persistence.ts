import { writeLogBatch, deleteLogsBefore } from "../../infra/logs";
import { configureLogSink, recordLog } from "./collector";

export function startLogPersistence(): () => void {
  const stop = configureLogSink(writeLogBatch);
  recordLog("info", "server.started", "server.restarts");
  return stop;
}

export async function purgeOldLogs(now: Date = new Date()): Promise<number> {
  return deleteLogsBefore(new Date(now.getTime() - 14 * 86_400_000));
}
