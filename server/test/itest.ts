import type { Pool } from "pg";
import { db, pool } from "../infra/db";
import {
  employees,
  regions,
  shifts,
  venues,
  type Employee,
  type InsertEmployee,
  type InsertRegion,
  type InsertShift,
  type InsertVenue,
  type Region,
  type Shift,
  type Venue,
} from "@shared/schema";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function assertLocalDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error("refuse: no database URL; integration tests need TEST_DATABASE_URL (see scripts/itest.sh)");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("refuse: database URL is not parseable");
  }
  if (!LOOPBACK_HOSTS.has(host)) throw new Error(`refuse: integration tests only run against a local throwaway database, got host ${host}`);
  return url;
}

/**
 * With a one-connection pool every request queues behind the previous one, so a
 * race test passes even when the code has no lock. Prove two backends really
 * serve queries at the same time, and that they sit on this machine.
 */
export async function assertRealParallelConnections(target: Pool = pool): Promise<void> {
  const results = await concurrently(2, () =>
    target.query<{ pid: number; addr: string | null }>("select pg_backend_pid() as pid, inet_server_addr()::text as addr, pg_sleep(0.05)"),
  );
  const rows = results.map((r) => {
    if (r.status === "rejected") throw r.reason;
    return r.value.rows[0];
  });
  if (rows[0].pid === rows[1].pid) throw new Error("pool served two simultaneous queries on one connection; race tests would pass falsely");
  for (const { addr } of rows) {
    if (!addr || !/^(127\.0\.0\.1|::1)(\/\d+)?$/.test(addr)) throw new Error(`refuse: connected server address is ${addr}, not loopback`);
  }
}

/** Empty every table in public and restart its ids, so each file and test starts from nothing. */
export async function resetDatabase(): Promise<void> {
  const { rows } = await pool.query<{ name: string }>(
    "select quote_ident(tablename) as name from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) throw new Error("no tables in public; the schema was not built");
  await pool.query(`truncate table ${rows.map((r) => r.name).join(", ")} restart identity cascade`);
}

/**
 * Call fn n times so that all n calls start in the same tick: every call waits
 * on one gate that opens only after all n have been scheduled.
 */
export async function concurrently<T>(n: number, fn: (index: number) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const calls = Array.from({ length: n }, async (_, i) => {
    await gate;
    return fn(i);
  });
  open();
  return Promise.allSettled(calls);
}

/**
 * Open n connections up front. A cold pool hands its first idle connections to the
 * first callers, who often finish before the new connections arrive, so a race
 * test on a cold pool mostly measures connect latency.
 */
export async function warmPool(n: number, target: Pool = pool): Promise<void> {
  const clients = await Promise.all(Array.from({ length: n }, () => target.connect()));
  for (const client of clients) client.release();
}

/** Run fn and report the most pool connections checked out at the same moment. */
export async function peakConnections<T>(fn: () => Promise<T>, target: Pool = pool): Promise<{ result: T; peak: number }> {
  let inUse = 0;
  let peak = 0;
  const acquire = () => {
    inUse += 1;
    peak = Math.max(peak, inUse);
  };
  const release = () => {
    inUse -= 1;
  };
  target.on("acquire", acquire);
  target.on("release", release);
  try {
    const result = await fn();
    return { result, peak };
  } finally {
    target.off("acquire", acquire);
    target.off("release", release);
  }
}

let seq = 0;
const next = () => (seq += 1);

export async function createRegion(overrides: Partial<InsertRegion> = {}): Promise<Region> {
  const n = next();
  const [row] = await db.insert(regions).values({ name: `測試區${n}`, code: `T${n}`, ...overrides }).returning();
  return row;
}

export async function createVenue(overrides: Partial<InsertVenue> & Pick<InsertVenue, "regionId">): Promise<Venue> {
  const n = next();
  const [row] = await db
    .insert(venues)
    .values({ name: `測試場館${n}`, shortName: `測館${n}`, latitude: 25.0, longitude: 121.5, radius: 200, ...overrides })
    .returning();
  return row;
}

export async function createEmployee(overrides: Partial<InsertEmployee> & Pick<InsertEmployee, "regionId">): Promise<Employee> {
  const n = next();
  const [row] = await db
    .insert(employees)
    .values({ name: `測試員工${n}`, employeeCode: `TEST${String(n).padStart(4, "0")}`, ...overrides })
    .returning();
  return row;
}

export async function createShift(
  values: Partial<InsertShift> & Pick<InsertShift, "employeeId" | "venueId" | "date" | "startTime" | "endTime">,
): Promise<Shift> {
  const [row] = await db.insert(shifts).values(values).returning();
  return row;
}
