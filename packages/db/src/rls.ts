/**
 * A drizzle client for the web app's restricted database role (#119). Every statement runs in
 * a transaction that first sets `pennyats.actor_id` and `pennyats.flags` for that transaction
 * only (set_config(..., true)), so pooled connections never carry one request's user into
 * another. Drizzle transactions get the same settings once, at the start.
 *
 * See packages/db/migrations/0026_row_level_security.sql for the policies that read them.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type RlsSettings = { actorId: string | null; flags: readonly string[] };

type Tx = postgres.TransactionSql;

export function createRlsDb(url: string, settings: () => RlsSettings) {
  const pool = postgres(url, { max: 10 });
  const prime = (tx: Tx, s: RlsSettings) =>
    tx`select set_config('pennyats.actor_id', ${s.actorId ?? ""}, true), set_config('pennyats.flags', ${s.flags.join(",")}, true)`;

  // The subset of the postgres-js client that drizzle's postgres-js driver uses.
  const client = {
    options: pool.options,
    unsafe(query: string, params?: unknown[]) {
      const s = settings();
      const run = (values: boolean) =>
        pool.begin(async (tx) => {
          await prime(tx, s);
          const q = tx.unsafe(query, params as never[]);
          return values ? await q.values() : await q;
        });
      return {
        then<T1, T2>(resolve: (v: unknown) => T1, reject?: (e: unknown) => T2) {
          return run(false).then(resolve, reject);
        },
        values: () => run(true),
      };
    },
    begin<T>(cb: (tx: Tx) => Promise<T>) {
      const s = settings();
      return pool.begin(async (tx) => {
        await prime(tx, s);
        return cb(tx);
      });
    },
  };
  return drizzle(client as unknown as postgres.Sql, { schema });
}
