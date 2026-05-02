import type { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";

declare module "express-session" {
  interface SessionData {
    adminId: number;
    adminName: string;
    adminLineId: string;
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
 * Cookie config matches what the old monolithic index.ts had:
 *   - 30-day sliding expiry
 *   - secure flag in production
 *   - sameSite=lax
 */
export function installSession(app: Express): void {
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    console.warn(
      "[WARN] SESSION_SECRET is not set. Using insecure fallback secret in production!",
    );
  }
  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({ conString: process.env.DATABASE_URL }),
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
