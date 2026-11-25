import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { processDueSchedulingMail } from "../src/lib/scheduling-delivery";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const result = await processDueSchedulingMail();
console.log(`Scheduling mail: ${result.sent} sent, ${result.failed} failed, ${result.processed} processed${result.unconfigured ? "; SMTP unconfigured" : ""}.`);
process.exit(result.failed ? 1 : 0);
