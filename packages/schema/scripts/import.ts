/**
 * Import a PennyATS open-format file into the database in DATABASE_URL:
 *   pnpm data:import pennyats-export.json
 * Runs in one transaction. Safe to run twice: records that already exist are skipped.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { auditLog, createDb } from "@pennyats/db";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ImportError, importWorkspace } from "../src/import";

// The repo-root .env, like the db scripts. Real environment variables win.
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
// pnpm runs this from packages/schema; resolve the path from where the command was typed.
const file = process.argv[2] ? resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]) : undefined;
if (!file) {
  console.error("Usage: pnpm data:import <file.json>");
  process.exit(1);
}
const db = createDb();
try {
  const summary = await importWorkspace(db, JSON.parse(readFileSync(file, "utf8")));
  await db.insert(auditLog).values({ action: "workspace_imported", actorId: null, actorType: "system", data: { via: "cli", ...summary.created } });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
} catch (err) {
  console.error(err instanceof ImportError ? err.message : err);
  process.exit(1);
}
