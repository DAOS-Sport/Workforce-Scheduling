/**
 * server/infra/db/index.ts
 *
 * Canonical database connection for the application.
 * Re-exports the pool and db instances from the original server/db.ts
 * so new code can import from this canonical path while backward-compat
 * callers still work via server/db.ts (which also re-exports these).
 */
export { pool, db } from "../../db";
