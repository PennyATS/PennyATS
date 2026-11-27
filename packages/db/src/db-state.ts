import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { DEMO_ADMIN_EMAIL, DEMO_MARKER_KEY, type DbState } from "./demo-guard";

type Row = { has_users: boolean; setup: boolean | null; marker: boolean; demo_admin: boolean };

/** What the demo guards need to know about a database. Null when it has no tables yet. */
export async function readDbState(db: Db): Promise<DbState | null> {
  const [probe] = await db.execute<{ ready: boolean }>(
    sql`select to_regclass('public.users') is not null and to_regclass('public.settings') is not null as ready`,
  );
  if (!probe?.ready) return null;
  const [row] = await db.execute<Row>(sql`
    select
      exists(select 1 from users) as has_users,
      (select setup_complete from instance limit 1) as setup,
      exists(select 1 from settings where key = ${DEMO_MARKER_KEY}) as marker,
      exists(select 1 from users where email = ${DEMO_ADMIN_EMAIL}) as demo_admin
  `);
  return { hasUsers: row.has_users, setupComplete: row.setup ?? false, demoMarker: row.marker, hasDemoAdmin: row.demo_admin };
}
