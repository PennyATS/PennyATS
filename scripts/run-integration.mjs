import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  console.error("Set TEST_DATABASE_URL to a disposable local Postgres database ending in _test.");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(testDatabaseUrl);
} catch {
  console.error("TEST_DATABASE_URL must be a valid Postgres URL.");
  process.exit(1);
}

const databaseName = decodeURIComponent(parsed.pathname.slice(1));
if (
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
  !databaseName.endsWith("_test")
) {
  console.error("TEST_DATABASE_URL must point to local Postgres and a database ending in _test.");
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  APP_URL: "http://127.0.0.1:3100",
  AI_PROVIDER: "",
  AI_API_KEY: "",
};
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

for (const args of [
  // Upgrade path for the role presets migration (#95), in its own throwaway database.
  ["--filter", "@pennyats/db", "exec", "tsx", "src/check-role-migration.ts"],
  ["db:migrate"],
  ["db:seed"],
  ["--filter", "@pennyats/web", "test:integration"],
]) {
  const result = spawnSync(pnpm, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
