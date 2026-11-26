/**
 * Send webhook deliveries that are due, including retries. The running app sends events
 * right away and retries on a timer, but a restart loses the timer, so schedule this too
 * (e.g. every 5 minutes with cron): `pnpm webhooks:deliver`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deliverDueWebhooks } from "../src/lib/webhooks";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const count = await deliverDueWebhooks();
console.log(`Attempted ${count} webhook deliver${count === 1 ? "y" : "ies"}.`);
process.exit(0);
