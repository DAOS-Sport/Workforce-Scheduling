/**
 * Process entry point. Delegates to the bootstrap module which knows
 * how to build the app, register routes, mount migrations, schedule cron
 * jobs and start listening.
 *
 * Backwards-compat: also re-exports `log` from shared/log so any caller
 * that still does `import { log } from "./index"` (e.g. older modules)
 * keeps working without changes.
 */
import { bootstrap } from "./bootstrap";
export { log } from "./shared/log";

bootstrap().catch((err) => {
  console.error("[bootstrap] fatal:", err);
  process.exit(1);
});
