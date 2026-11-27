/**
 * Upgrade check for the role presets migration (#95), run by `pnpm test:integration`.
 *
 * Builds a throwaway database next to TEST_DATABASE_URL at the schema before roles existed,
 * adds users and an invite with the old admin / recruiter / interviewer enum, applies the rest
 * of the migrations, and checks that everyone kept their role and the presets exist.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const BEFORE_ROLES = "0022_little_titania";
const PRESETS = ["admin", "head_of_talent", "ta_manager", "recruiter", "coordinator", "hiring_manager", "interviewer", "executive"];

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Set TEST_DATABASE_URL (a local database ending in _test).");
const baseUrl = new URL(base);
const baseName = decodeURIComponent(baseUrl.pathname.slice(1));
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname) || !baseName.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to local Postgres and a database ending in _test.");
}
const name = `${baseName.slice(0, -"_test".length)}_roles_upgrade_test`;
const url = new URL(base);
url.pathname = `/${name}`;

const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
const cut = journal.entries.findIndex((e) => e.tag === BEFORE_ROLES);
if (cut < 0) throw new Error(`Migration ${BEFORE_ROLES} not found.`);

// A copy of the migrations folder that stops just before the roles table.
const partial = mkdtempSync(join(tmpdir(), "pennyats-migrations-"));
cpSync(migrations, partial, { recursive: true });
writeFileSync(join(partial, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }));

const admin = postgres(base, { max: 1, onnotice: () => {} });
const fail = (message: string): never => {
  throw new Error(`Role migration check failed: ${message}`);
};

try {
  await admin.unsafe(`drop database if exists "${name}"`);
  await admin.unsafe(`create database "${name}"`);
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: partial });
    await sql`insert into users (email, name, role) values
      ('old.admin@example.com', 'Old Admin', 'admin'),
      ('old.recruiter@example.com', 'Old Recruiter', 'recruiter'),
      ('old.interviewer@example.com', 'Old Interviewer', 'interviewer')`;
    await sql`insert into invites (token_hash, email, role, expires_at)
      values ('role-migration-check', 'pending@example.com', 'interviewer', now() + interval '1 day')`;

    await migrate(drizzle(sql), { migrationsFolder: migrations });

    const presets = await sql<{ key: string }[]>`select key from roles where is_system order by key`;
    if (presets.map((r) => r.key).join() !== [...PRESETS].sort().join()) fail(`presets are ${presets.map((r) => r.key).join(", ")}`);
    const people = await sql<{ email: string; key: string }[]>`
      select u.email, r.key from users u join roles r on r.id = u.role_id order by u.email`;
    const expected: Record<string, string> = {
      "old.admin@example.com": "admin",
      "old.interviewer@example.com": "interviewer",
      "old.recruiter@example.com": "recruiter",
    };
    for (const p of people) if (expected[p.email] !== p.key) fail(`${p.email} became ${p.key}`);
    if (people.length !== 3) fail(`expected 3 users, found ${people.length}`);
    const [invite] = await sql<{ key: string }[]>`select r.key from invites i join roles r on r.id = i.role_id`;
    if (invite?.key !== "interviewer") fail(`the pending invite became ${invite?.key}`);
    console.log("Role migration check passed: existing users and invites kept admin, recruiter, and interviewer.");
  } finally {
    await sql.end();
  }
  await admin.unsafe(`drop database if exists "${name}"`);
} finally {
  await admin.end();
  rmSync(partial, { recursive: true, force: true });
}
