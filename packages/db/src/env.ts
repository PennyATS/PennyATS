import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Load the repo-root .env for CLI scripts (migrate, seed, drizzle-kit).
 * pnpm runs these from packages/db, so Node would not find the root file on its own.
 * Variables already set in the environment win over the file.
 */
export function loadRootEnv() {
  const path = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
