/**
 * server/bootstrap/session.ts
 *
 * Sets up the express-session middleware backed by Postgres.
 * The session store is created via server/infra/db/sessionStore.ts so the
 * connect-pg-simple details stay in one canonical infra location.
 */
import type { Express } from "express";
import session from "express-session";
import { pool } from "../infra/db";
import { createPgSessionStore } from "../infra/db/sessionStore";

declare module "express-session" {
  interface SessionData {
    adminId: number;
    adminName: string;
    adminLineId: string;
    adminAuthKind: "personal" | "shared_password";
    adminOAuthState?: string;
    adminOAuthRedirectUri?: string;
  }
}

/**
 * Ensure the connect-pg-simple-backed session table exists. Idempotent;
 * safe to call on every boot.
 */
export async function ensureSessionTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    ) WITH (OIDS=FALSE)
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`,
  );
}

/**
 * Install express-session middleware on the given app, backed by Postgres.
 *
 * Cookie config:
 *   - 30-day expiry counted from the last time the session was saved;
 *     not sliding (rolling is off, ordinary requests don't extend it)
 *   - secure flag in production
 *   - sameSite=lax
 */
export function installSession(app: Express): void {
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    console.warn(
      "[WARN] SESSION_SECRET is not set. Using insecure fallback secret in production!",
    );
  }
  app.use(
    session({
      store: createPgSessionStore(),
      secret: process.env.SESSION_SECRET || "fallback-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
    }),
  );
}
