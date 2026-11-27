/**
 * Export the whole workspace in the PennyATS open format to stdout or a file:
 *   pnpm -s data:export > pennyats-export.json   (-s keeps pnpm's banner out of the file)
 *   pnpm data:export --out pennyats-export.json
 * The file holds candidate data. Store and share it as carefully as the database itself.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { auditLog, createDb } from "@pennyats/db";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportWorkspace } from "../src/export";

// The repo-root .env, like the db scripts. Real environment variables win.
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const db = createDb();
const doc = await exportWorkspace(db);
const text = `${JSON.stringify(doc, null, 2)}\n`;
const i = process.argv.indexOf("--out");
// pnpm runs this from packages/schema; resolve the path from where the command was typed.
if (i >= 0 && process.argv[i + 1]) writeFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[i + 1]), text);
else process.stdout.write(text);
await db.insert(auditLog).values({ action: "workspace_exported", actorId: null, actorType: "system", data: { via: "cli", candidates: doc.candidates.length } });
console.error(`Exported ${doc.jobs.length} jobs, ${doc.candidates.length} candidates, ${doc.applications.length} applications (schema ${doc.schema_version}).`);
process.exit(0);
