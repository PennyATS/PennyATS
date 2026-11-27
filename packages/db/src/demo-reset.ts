// pnpm demo:reset: wipe the public demo's database and uploads, then migrate and reseed (#10).
// Runs only with DEMO_MODE=true, DEMO_RESET_CONFIRM set to the database name, and a database
// that is empty or was created by this script. See docs/demo.md.
import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, settings } from "./index";
import { readDbState } from "./db-state";
import { DEMO_MARKER_KEY, demoResetRefusal } from "./demo-guard";
import { loadRootEnv } from "./env";

loadRootEnv();

const db = createDb();
const refusal = demoResetRefusal(process.env, await readDbState(db));
if (refusal) {
  console.error(`demo:reset refused: ${refusal}`);
  process.exit(1);
}

console.log("Wiping the demo database...");
await db.execute(sql`drop schema if exists drizzle cascade`);
await db.execute(sql`drop schema if exists public cascade`);
await db.execute(sql`create schema public`);

// Uploaded resumes: only files the app wrote (uuid names), so a wrong STORAGE_DIR cannot wipe a folder.
const storageDir = process.env.STORAGE_DIR;
if (storageDir) {
  const files = await readdir(storageDir).catch(() => [] as string[]);
  const ours = files.filter((f) => /^[0-9a-f-]{36}\.[a-z]{2,5}$/.test(f));
  await Promise.all(ours.map((f) => rm(path.join(storageDir, f), { force: true })));
  console.log(`Removed ${ours.length} uploaded files.`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
function run(script: string) {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(here, script)], { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error(`demo:reset: ${script} failed.`);
    process.exit(result.status ?? 1);
  }
}

run("migrate.ts");
// Mark the database as a demo before seeding, so a failed seed can still be retried by the next reset.
await db.insert(settings).values({ key: DEMO_MARKER_KEY, value: { resetAt: new Date().toISOString() } });
run("seed.ts");
console.log("Demo reset complete.");
process.exit(0);
