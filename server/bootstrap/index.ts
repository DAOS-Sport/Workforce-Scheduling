import { buildApp } from "./app";
import { startListening } from "./http";
import { runStartupMigrations } from "./migrations";
import { registerCronJobs } from "./scheduler";
import { setupClientServing } from "./viteOrStatic";
import { installLogStamp } from "../shared/log";
import { startLogPersistence } from "../shared/logging/persistence";

/**
 * The single entry point used by server/index.ts.
 *
 * Boot sequence:
 *   1. Run idempotent startup migrations
 *   2. Seed database
 *   3. Build the Express app (request id, session, body parsers, request logger,
 *      every route via routes.ts, the JSON error handler) with buildApp()
 *   6. Mount Vite (dev) or static assets (prod) — must be LAST
 *   7. Listen on PORT (default 5000)
 *   8. Register cron jobs (only when REPLIT_DEPLOYMENT === "1")
 */
export async function bootstrap(): Promise<void> {
  installLogStamp();
  startLogPersistence();

  // 1) idempotent migrations first — ensures schema is up-to-date before seed queries it
  await runStartupMigrations();

  // 2) seed
  try {
    const { seedDatabase } = await import("./seed");
    await seedDatabase();
  } catch (err) {
    console.error("Seed error:", err);
  }

  // 3-5) app with its session, body parsers, request logger, every route and the error handler
  const { app, httpServer } = await buildApp();

  // 6) client (Vite dev or static prod) — MUST come after API routes
  await setupClientServing(httpServer, app);

  // 7) listen (delegates to bootstrap/http.ts)
  startListening(httpServer, () => {
    // 8) schedule cron jobs (skipped in dev)
    registerCronJobs();
  });
}
