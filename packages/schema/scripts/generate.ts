/** Writes docs/schema/v1/*.schema.json from the zod format. Run `pnpm schema:generate` after changing it. */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { schemaFiles } from "../src/generate";

const dir = fileURLToPath(new URL("../../../docs/schema/v1/", import.meta.url));
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(schemaFiles())) writeFileSync(dir + name, text);
console.log(`Wrote ${Object.keys(schemaFiles()).length} schema files to ${dir}`);
