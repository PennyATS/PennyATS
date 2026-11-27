/**
 * Create or update the role the web app connects as (#119). Run as the database owner after
 * migrations: `pnpm db:app-role`. Needs DATABASE_URL (owner) and APP_DB_PASSWORD.
 *
 * The role can read and write rows but cannot bypass row-level security, own tables, or run
 * migrations. Point the app at it with APP_DATABASE_URL. See docs/rls.md.
 */
import postgres from "postgres";
import { loadRootEnv } from "./env";

loadRootEnv();

const url = process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;
const name = process.env.APP_DB_USER || "pennyats_app";
if (!url) {
  console.error("DATABASE_URL is not set (use the owner that runs migrations).");
  process.exit(1);
}
if (!password) {
  console.error("APP_DB_PASSWORD is not set. Choose a password for the app's database role.");
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
  console.error("APP_DB_USER must be a plain lowercase Postgres role name.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const [exists] = await sql`select 1 from pg_roles where rolname = ${name}`;
  const ident = sql(name);
  if (exists) await sql`alter role ${ident} with login nosuperuser nocreatedb nocreaterole nobypassrls password ${sql.unsafe(`'${password.replace(/'/g, "''")}'`)}`;
  else await sql`create role ${ident} with login nosuperuser nocreatedb nocreaterole nobypassrls password ${sql.unsafe(`'${password.replace(/'/g, "''")}'`)}`;
  const [{ db }] = await sql<{ db: string }[]>`select current_database() as db`;
  await sql`grant connect on database ${sql(db)} to ${ident}`;
  await sql`grant usage on schema public to ${ident}`;
  await sql`grant select, insert, update, delete on all tables in schema public to ${ident}`;
  await sql`grant usage, select on all sequences in schema public to ${ident}`;
  await sql`grant execute on all functions in schema public to ${ident}`;
  // Tables added by later migrations get the same grants.
  await sql`alter default privileges in schema public grant select, insert, update, delete on tables to ${ident}`;
  await sql`alter default privileges in schema public grant usage, select on sequences to ${ident}`;
  console.log(`App role ${name} is ready. Set APP_DATABASE_URL to connect the app as ${name}.`);
} finally {
  await sql.end();
}
