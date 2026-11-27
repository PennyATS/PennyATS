import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as dbSchema from "@pennyats/db";
import { COVERAGE, NOT_IN_V1 } from "./coverage";
import { ExportDocument, SCHEMA_VERSION } from "./format";
import { schemaFiles } from "./generate";
import { ImportError, parseExport } from "./import";

const docsDir = fileURLToPath(new URL("../../../docs/schema/v1/", import.meta.url));

test("docs/schema/v1 matches the code (run `pnpm schema:generate` to update it)", () => {
  const files = schemaFiles();
  assert.deepEqual(readdirSync(docsDir).sort(), Object.keys(files).sort(), "docs/schema/v1 has extra or missing files");
  for (const [name, text] of Object.entries(files)) {
    const committed = readFileSync(docsDir + name, "utf8").replace(/\r\n/g, "\n");
    assert.equal(committed, text, `${name} is out of date. Run \`pnpm schema:generate\` and commit the result.`);
  }
});

test("the changelog has an entry for the current schema version", () => {
  const changelog = readFileSync(fileURLToPath(new URL("../../../docs/schema/CHANGELOG.md", import.meta.url)), "utf8");
  assert.ok(changelog.includes(`## ${SCHEMA_VERSION}`), `Add a "## ${SCHEMA_VERSION}" section to docs/schema/CHANGELOG.md`);
});

test("every column of every covered table is mapped to a field or excluded with a reason", () => {
  for (const { table, name, columns } of COVERAGE) {
    const actual = Object.values(getTableColumns(table as PgTable)).map((c) => c.name).sort();
    const declared = Object.keys(columns).sort();
    const unmapped = actual.filter((c) => !declared.includes(c));
    const stale = declared.filter((c) => !actual.includes(c));
    assert.deepEqual(unmapped, [], `${name} has columns the open format doesn't account for: ${unmapped.join(", ")}. Map them in src/coverage.ts or exclude them with a reason.`);
    assert.deepEqual(stale, [], `${name} no longer has columns listed in src/coverage.ts: ${stale.join(", ")}`);
    for (const [column, m] of Object.entries(columns)) {
      if ("excluded" in m) assert.ok(m.excluded.length > 10, `${name}.${column} needs a real reason for being excluded`);
    }
  }
});

// Instance plumbing that never belongs in a hiring-data export.
const SYSTEM_TABLES = new Set([
  "sessions",
  "invites",
  "password_resets",
  "settings",
  "google_calendar_connections",
  "instance",
  "audit_log",
  "api_keys",
  "webhooks",
]);

test("every database table is covered, deliberately left for later, or system plumbing", () => {
  const covered = new Set(COVERAGE.map((c) => c.name));
  const tables = Object.values(dbSchema)
    .filter((v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) !== null && is(v, PgTable))
    .map((t) => getTableName(t as PgTable));
  assert.ok(tables.length > 20);
  const unknown = tables.filter((t) => !covered.has(t) && !(t in NOT_IN_V1) && !SYSTEM_TABLES.has(t));
  assert.deepEqual(unknown, [], `New tables need a decision in src/coverage.ts (COVERAGE or NOT_IN_V1) or the system list: ${unknown.join(", ")}`);
});

const minimal = {
  format: "pennyats-export",
  schema_version: "1.0.0",
  exported_at: "2026-11-26T00:00:00.000Z",
  people: [],
  jobs: [],
  candidates: [],
  applications: [],
  interviews: [],
  scorecards: [],
  notes: [],
};

test("readers accept any 1.x document and drop fields they don't know", () => {
  const doc = parseExport({ ...minimal, schema_version: "1.4.0", future_field: [1, 2], candidates: [] });
  assert.equal("future_field" in doc, false);
  assert.ok(ExportDocument.safeParse(doc).success);
});

test("readers refuse other major versions and malformed files with a clear message", () => {
  assert.throws(() => parseExport({ ...minimal, schema_version: "2.0.0" }), ImportError);
  assert.throws(() => parseExport({ ...minimal, jobs: [{ id: "x" }] }), /doesn't match/);
  assert.throws(() => parseExport(null), /schema version 1\.x/);
});
