/**
 * server/observability/metrics-store.ts
 *
 * In-memory ring buffer for request metrics and external-service health probes.
 * Tracks all requests + special per-endpoint stats for /api/internal/*.
 * No external dependencies — pure in-memory, intentionally not persisted.
 */

export interface RequestRecord {
  ts: number;
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
  requestId: string;
  isError: boolean;
  isInternal: boolean;
}

export interface InternalApiStat {
  endpoint: string;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  lastCalledAt: number | null;
}

export interface ServiceProbeResult {
  name: string;
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  checkedAt: number;
  error?: string;
}

const RING_SIZE = 10_000;
const PROBE_TTL_MS = 30_000;

const ring: RequestRecord[] = new Array(RING_SIZE);
let head = 0;
let count = 0;

const internalStats = new Map<string, InternalApiStat>();

const probeCache = new Map<string, ServiceProbeResult>();

function push(rec: RequestRecord) {
  ring[head % RING_SIZE] = rec;
  head++;
  if (count < RING_SIZE) count++;
  if (rec.isInternal) trackInternal(rec);
}

function trackInternal(rec: RequestRecord) {
  const key = `${rec.method}:${rec.route}`;
  const existing = internalStats.get(key) ?? {
    endpoint: key,
    callCount: 0,
    errorCount: 0,
    totalDurationMs: 0,
    lastCalledAt: null,
  };
  existing.callCount++;
  if (rec.isError) existing.errorCount++;
  existing.totalDurationMs += rec.durationMs;
  existing.lastCalledAt = rec.ts;
  internalStats.set(key, existing);
}

function records(): RequestRecord[] {
  if (count < RING_SIZE) return ring.slice(0, count).filter(Boolean);
  const tail = head % RING_SIZE;
  return [...ring.slice(tail), ...ring.slice(0, tail)].filter(Boolean);
}

function recentWindow(windowMs = 60_000): RequestRecord[] {
  const now = Date.now();
  return records().filter((r) => now - r.ts <= windowMs);
}

function computeMetrics() {
  const now = Date.now();
  const last60 = recentWindow(60_000);
  const last1 = recentWindow(1_000);

  const durations = last60.map((r) => r.durationMs).sort((a, b) => a - b);
  const avgLatency = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const p95Idx = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
  const p95Latency = durations[p95Idx] ?? 0;

  const errorCount60 = last60.filter((r) => r.isError).length;

  const mem = process.memoryUsage();

  return {
    timestamp: new Date(now).toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    requestsLast60s: last60.length,
    requestsLastSecond: last1.length,
    errorsLast60s: errorCount60,
    errorRateLast60s: last60.length ? +(errorCount60 / last60.length).toFixed(4) : 0,
    avgLatencyMs: +avgLatency.toFixed(2),
    p95LatencyMs: +p95Latency.toFixed(2),
    memoryMb: {
      rss: +(mem.rss / 1024 / 1024).toFixed(2),
      heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotal: +(mem.heapTotal / 1024 / 1024).toFixed(2),
    },
  };
}

function internalApiStats() {
  return Array.from(internalStats.values()).map((s) => ({
    ...s,
    avgLatencyMs: s.callCount ? +(s.totalDurationMs / s.callCount).toFixed(2) : 0,
    errorRate: s.callCount ? +(s.errorCount / s.callCount).toFixed(4) : 0,
    lastCalledAtIso: s.lastCalledAt ? new Date(s.lastCalledAt).toISOString() : null,
  }));
}

function setProbe(result: ServiceProbeResult) {
  probeCache.set(result.name, result);
}

function getProbe(name: string): ServiceProbeResult | undefined {
  const cached = probeCache.get(name);
  if (!cached) return undefined;
  if (Date.now() - cached.checkedAt > PROBE_TTL_MS) return undefined;
  return cached;
}

function allProbes(): ServiceProbeResult[] {
  return Array.from(probeCache.values());
}

export const metricsStore = { push, computeMetrics, internalApiStats, setProbe, getProbe, allProbes };
