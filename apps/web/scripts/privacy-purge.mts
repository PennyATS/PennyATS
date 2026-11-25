/**
 * Delete candidates past the retention period set on the Privacy settings page.
 * Safe to run on a schedule (e.g. daily cron): `pnpm privacy:purge`.
 * Does nothing when no retention period is set.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deleteCandidates, expiredCandidateIds, getPrivacySettings } from "../src/lib/privacy";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { retentionMonths } = await getPrivacySettings();
if (!retentionMonths) {
  console.log("No retention period set. Nothing to do.");
  process.exit(0);
}

const ids = await expiredCandidateIds(retentionMonths);
const count = await deleteCandidates(ids, {
  actorId: null,
  reason: `Retention: no activity for ${retentionMonths} months`,
  action: "retention_purge",
});
console.log(`Deleted ${count} candidate${count === 1 ? "" : "s"} past the ${retentionMonths}-month retention period.`);
process.exit(0);
