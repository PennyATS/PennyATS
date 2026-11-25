import { createDb, type Db } from "@pennyats/db";

// One pool per server process. Cached on globalThis so dev hot reloads don't leak connections.
const globalForDb = globalThis as unknown as { pennyatsDb?: Db };

export function db(): Db {
  globalForDb.pennyatsDb ??= createDb();
  return globalForDb.pennyatsDb;
}
