/** Writes docs/api/openapi.json from the API route table. Run with `pnpm api:spec` after changing the API. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiText } from "../src/lib/api/openapi";

const target = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/api/openapi.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, openApiText());
console.log(`Wrote ${target}`);
