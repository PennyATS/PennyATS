import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pullAllGoogleInterviews } from "../src/lib/google-calendar";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const result = await pullAllGoogleInterviews();
console.log(`Calendar sync: ${result.checked} checked, ${result.updated} updated, ${result.failed} failed.`);
process.exit(result.failed ? 1 : 0);
