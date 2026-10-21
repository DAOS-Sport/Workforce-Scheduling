/**
 * 健康回報格式 health-v1（見 D:\工作內容\駿斯\tools\health-hub\contract\README.md）。
 */
export type Level = "green" | "yellow" | "red";

const ORDER: Record<Level, number> = { green: 0, yellow: 1, red: 2 };

export function worst(levels: Level[]): Level {
  return levels.reduce<Level>((acc, l) => (ORDER[l] > ORDER[acc] ? l : acc), "green");
}

export interface Pipeline {
  id: string;
  name: string;
  level: Level;
  reason: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  source: string | null;
}

export interface HealthReport {
  system: string;
  build: string;
  checkedAt: string;
  overall: Level;
  pipelines: Pipeline[];
}

/** 排程或同步工作最後一次的執行狀態（由 server/shared/health/healthState.ts 記錄）。 */
export interface JobState {
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastStatus?: "running" | "success" | "failed";
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  lastTrigger?: string;
  lastSummary?: Record<string, unknown>;
}

/** 外部系統最後一次呼叫的成敗。 */
export interface IntegrationState {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  consecutiveFailures?: number;
}

export type JobSchedule =
  | { kind: "daily"; at: number }
  | { kind: "weekly"; weekday: number; at: number }
  | { kind: "every30"; from: number; to: number };
