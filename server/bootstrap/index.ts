import { createApp, installErrorHandler } from "./app";
import { buildHttpServer, startListening } from "./http";
import { runStartupMigrations } from "./migrations";
import { registerCronJobs } from "./scheduler";
import { setupClientServing } from "./viteOrStatic";
import { registerRoutes } from "../routes";

/**
 * The single entry point used by server/index.ts.
 *
 * Boot sequence (preserves the old monolithic index.ts ordering exactly):
 *   1. Seed database
 *   2. Run idempotent startup migrations
 *   3. Build the Express app (session, body parsers, request logger)
 *   4. Register every route via routes.ts (which fans out to modules)
 *   5. Install the JSON error handler
 *   6. Mount Vite (dev) or static assets (prod) — must be LAST
 *   7. Listen on PORT (default 5000)
 *   8. Register cron jobs (only when REPLIT_DEPLOYMENT === "1")
 */
export async function bootstrap(): Promise<void> {
  // 1) seed
  try {
    const { seedDatabase } = await import("../seed");
    await seedDatabase();
  } catch (err) {
    console.error("Seed error:", err);
  }

  // 2) idempotent migrations
  await runStartupMigrations();

  // 3) build app
  const app = await createApp();
  const httpServer = buildHttpServer(app);

  // 4) routes
  await registerRoutes(httpServer, app);

  // 5) error handler
  installErrorHandler(app);

  // 6) client (Vite dev or static prod) — MUST come after API routes
  await setupClientServing(httpServer, app);

  // 7) listen (delegates to bootstrap/http.ts)
  startListening(httpServer, () => {
    // 8) schedule cron jobs (skipped in dev)
    registerCronJobs();
  });
}
