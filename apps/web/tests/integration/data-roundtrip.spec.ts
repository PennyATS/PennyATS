/**
 * Open data format round trip: export the seeded test database, import it into a fresh,
 * migrated database, export that, and compare. Then import again to prove it's idempotent.
 */
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, users } from "@pennyats/db";
import { exportWorkspace, ExportDocument, importWorkspace } from "@pennyats/schema";
import { expect, test } from "@playwright/test";

const sourceUrl = process.env.TEST_DATABASE_URL!;
const target = new URL(sourceUrl);
const targetName = `${decodeURIComponent(target.pathname.slice(1))}_roundtrip`;
target.pathname = `/${targetName}`;

test("export, import into a clean database, and export again gives the same document", async () => {
  test.setTimeout(240_000);
  const source = createDb(sourceUrl);
  await source.execute(sql.raw(`drop database if exists "${targetName}" with (force)`));
  await source.execute(sql.raw(`create database "${targetName}"`));
  const clean = createDb(target.toString());
  try {
    await migrate(clean, { migrationsFolder: join(__dirname, "../../../../packages/db/migrations") });

    const first = await exportWorkspace(source);
    expect(ExportDocument.safeParse(first).success).toBe(true);
    expect(first.candidates.length).toBeGreaterThan(100);
    expect(first.applications.some((a) => a.events.some((e) => e.type === "stage_changed"))).toBe(true);
    expect(first.scorecards.length).toBeGreaterThan(0);
    expect(first.interviews.length).toBeGreaterThan(0);

    const summary = await importWorkspace(clean, JSON.parse(JSON.stringify(first)));
    expect(summary.created.candidates).toBe(first.candidates.length);
    expect(summary.created.applications).toBe(first.applications.length);
    expect(summary.created.scorecards).toBe(first.scorecards.length);
    expect(summary.created.people).toBe(first.people.length);
    expect(summary.renamed_slugs).toEqual([]);

    const second = await exportWorkspace(clean, new Date(first.exported_at));
    // Compare section by section so a failure points at the part that changed.
    for (const key of ["people", "jobs", "candidates", "applications", "interviews", "scorecards", "notes"] as const) {
      expect(second[key], `${key} survive the round trip`).toEqual(first[key]);
    }
    expect(second).toEqual(first);

    // Imported people can't sign in until an admin reactivates them.
    const imported = await clean.select({ active: users.active, passwordHash: users.passwordHash }).from(users);
    expect(imported.every((u) => !u.active && u.passwordHash === null)).toBe(true);

    // Importing the same file again changes nothing.
    const again = await importWorkspace(clean, first);
    expect(Object.values(again.created).every((n) => n === 0)).toBe(true);
    expect(again.skipped_existing.candidates).toBe(first.candidates.length);
    expect(await exportWorkspace(clean, new Date(first.exported_at))).toEqual(first);

    // A file with a broken reference is refused before anything is written.
    const broken = {
      ...first,
      candidates: [],
      jobs: [],
      applications: [{ ...first.applications[0], id: "00000000-0000-4000-8000-000000000001", job_id: "00000000-0000-4000-8000-000000000002" }],
      interviews: [],
      scorecards: [],
      notes: [],
    };
    await expect(importWorkspace(clean, broken)).rejects.toThrow(/broken references/);
    expect(await exportWorkspace(clean, new Date(first.exported_at))).toEqual(first);
  } finally {
    await clean.$client.end();
    await source.execute(sql.raw(`drop database if exists "${targetName}" with (force)`));
    await source.$client.end();
  }
});
