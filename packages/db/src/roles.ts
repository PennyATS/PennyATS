import { roles } from "./schema";
import type { Db } from "./index";

type Executor = Pick<Db, "select">;

/** Role ids by key ("admin", "recruiter", ...). System roles are created by migration 0023 (#95). */
export async function roleIdsByKey(db: Executor): Promise<Map<string, string>> {
  const rows = await db.select({ id: roles.id, key: roles.key }).from(roles);
  return new Map(rows.map((r) => [r.key, r.id]));
}

/** The id of one role, or an error naming the missing key (migrations not applied). */
export async function roleIdFor(db: Executor, key: string): Promise<string> {
  const id = (await roleIdsByKey(db)).get(key);
  if (!id) throw new Error(`Role "${key}" not found. Run pnpm db:migrate first.`);
  return id;
}
