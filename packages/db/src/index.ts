import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export * from "./password";
export * from "./defaults";
export * from "./roles";
export * from "./rls";
export { schema };

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at any Postgres instance (see .env.example).",
    );
  }
  const client = postgres(url, { max: 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export { default as postgres } from "postgres";
