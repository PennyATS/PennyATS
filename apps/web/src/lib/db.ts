import { createDb, createRlsDb, type Db } from "@pennyats/db";
import { rlsSettings } from "./db-context";

// One pool per server process. Cached on globalThis so dev hot reloads don't leak connections.
const globalForDb = globalThis as unknown as { pennyatsDb?: Db };

/**
 * With APP_DATABASE_URL set, the app connects as the restricted role and every statement
 * carries the acting user for row-level security (#119, docs/rls.md). Without it, the app uses
 * DATABASE_URL directly and only the application's own checks apply.
 */
export function db(): Db {
  const appUrl = process.env.APP_DATABASE_URL;
  globalForDb.pennyatsDb ??= (appUrl ? createRlsDb(appUrl, rlsSettings) : createDb()) as Db;
  return globalForDb.pennyatsDb;
}
