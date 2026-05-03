/**
 * server/infra/db/sessionStore.ts
 *
 * Encapsulates the connect-pg-simple session-store factory.
 * The bootstrap/session.ts module uses this; nothing else needs to know
 * about the Postgres session-table internals.
 */
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

export function createPgSessionStore(): session.Store {
  const PgStore = connectPgSimple(session);
  return new PgStore({ conString: process.env.DATABASE_URL });
}
