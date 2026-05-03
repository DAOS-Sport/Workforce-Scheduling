/**
 * server/db.ts — backward-compat re-export shim.
 *
 * The canonical DB connection now lives in server/infra/db/index.ts.
 * This file exists so all existing importers that do
 *   import { db } from "../db"
 *   import { pool } from "../../db"
 * keep working without changes.
 *
 * New code should import from server/infra/db instead.
 */
export { pool, db } from "./infra/db";
