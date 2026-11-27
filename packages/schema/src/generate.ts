/** Turns the zod format into JSON Schema files. Pure and deterministic, so a test can compare with docs/. */
import { z } from "zod";
import { ENTITIES, registry, SCHEMA_ID_BASE, SCHEMA_VERSION } from "./format";

const FILE_BY_ID = Object.fromEntries(ENTITIES.map((e) => [e.id, `${e.file}.schema.json`]));

function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "pattern" && (value as Record<string, unknown>).format) continue;
    if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
    out[k] = clean(v);
  }
  return out as T;
}

/** File name to file text, for docs/schema/v1/. */
export function schemaFiles(): Record<string, string> {
  const { schemas } = z.toJSONSchema(registry, {
    uri: (id) => `${SCHEMA_ID_BASE}/${FILE_BY_ID[id]}`,
    io: "output",
    unrepresentable: "any",
    override: (ctx) => {
      const meta = z.globalRegistry.get(ctx.zodSchema);
      if (!meta) return;
      const json = ctx.jsonSchema as Record<string, unknown>;
      for (const [k, v] of Object.entries(meta)) if (k !== "id" && json[k] === undefined) json[k] = v;
    },
  });
  const files: Record<string, string> = {};
  for (const e of ENTITIES) {
    const schema = clean(schemas[e.id] as Record<string, unknown>);
    // Refs to sibling files are relative, so the folder works offline and when copied.
    const text = JSON.stringify({ ...schema, "x-pennyats-schema-version": SCHEMA_VERSION }, null, 2)
      .replaceAll(`"${SCHEMA_ID_BASE}/`, '"./')
      .replace(/"\$id": "\.\/([^"]+)"/, `"$id": "${SCHEMA_ID_BASE}/$1"`);
    files[`${e.file}.schema.json`] = `${text}\n`;
  }
  return files;
}
