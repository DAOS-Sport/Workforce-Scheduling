import { pool } from "../infra/db";

let seq = 0;

/**
 * Makes the database itself reject writes to `table` whose new row satisfies `condition` (SQL over `NEW`),
 * for the duration of `run`. A real failing statement, not a stub: it aborts the statement the way a
 * constraint violation or a full disk would.
 */
export async function withFailingWrites<T>(
  table: string,
  event: "insert" | "update",
  condition: string,
  run: () => Promise<T>,
): Promise<T> {
  const name = `itest_fail_${(seq += 1)}`;
  await pool.query(`
    create function ${name}() returns trigger language plpgsql as $$
    begin
      if ${condition} then raise exception 'itest: forced write failure'; end if;
      return NEW;
    end $$`);
  await pool.query(`create trigger ${name} before ${event} on ${table} for each row execute function ${name}()`);
  try {
    return await run();
  } finally {
    await pool.query(`drop trigger ${name} on ${table}`);
    await pool.query(`drop function ${name}()`);
  }
}
