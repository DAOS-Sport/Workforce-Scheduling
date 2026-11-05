import { execFileSync } from "node:child_process";
import path from "node:path";
import { assertLocalDatabaseUrl } from "./itest";

/**
 * Build the schema the same two ways production does: drizzle-kit push for
 * shared/schema.ts, then the boot-time ensure* migrations.
 */
export default async function buildSchema(): Promise<void> {
  const url = assertLocalDatabaseUrl(process.env.DATABASE_URL);

  const drizzleKit = path.resolve("node_modules/drizzle-kit/bin.cjs");
  try {
    execFileSync(process.execPath, [drizzleKit, "push", "--force"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`drizzle-kit push failed\n${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`);
  }

  // runStartupMigrations only logs a failed step and carries on; turn those logs into a hard failure.
  const { runStartupMigrations } = await import("../bootstrap/migrations");
  const { pool } = await import("../infra/db");
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    await runStartupMigrations();
  } finally {
    console.log = originalLog;
    await pool.end();
  }
  const failed = lines.filter((l) => l.includes("失敗"));
  if (failed.length > 0) throw new Error(`startup migrations failed:\n${failed.join("\n")}`);
}
