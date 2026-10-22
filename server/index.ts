/**
 * Process entry point. Delegates to the bootstrap module which knows
 * how to build the app, register routes, mount migrations, schedule cron
 * jobs and start listening.
 */
import { bootstrap } from "./bootstrap";

bootstrap().catch((err) => {
  console.error("[bootstrap] fatal:", err);
  process.exit(1);
});
