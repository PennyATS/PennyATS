import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseName, demoResetRefusal, seedRefusal, type DbState } from "./demo-guard";

const url = "postgres://u:p@host:5432/pennyats_demo";
const ok = { DEMO_MODE: "true", DATABASE_URL: url, DEMO_RESET_CONFIRM: "pennyats_demo" };
const empty: DbState = { hasUsers: false, setupComplete: false, demoMarker: false, hasDemoAdmin: false };
const real: DbState = { hasUsers: true, setupComplete: true, demoMarker: false, hasDemoAdmin: false };
const demo: DbState = { hasUsers: true, setupComplete: true, demoMarker: true, hasDemoAdmin: true };

test("databaseName reads the path", () => {
  assert.equal(databaseName(url), "pennyats_demo");
  assert.equal(databaseName("postgres://host/"), null);
  assert.equal(databaseName("not a url"), null);
});

test("demo reset needs DEMO_MODE and a matching confirmation", () => {
  assert.match(demoResetRefusal({ ...ok, DEMO_MODE: undefined }, empty) ?? "", /DEMO_MODE=true/);
  assert.match(demoResetRefusal({ ...ok, DEMO_RESET_CONFIRM: "other" }, empty) ?? "", /DEMO_RESET_CONFIRM=pennyats_demo/);
  assert.match(demoResetRefusal({ ...ok, DATABASE_URL: undefined }, empty) ?? "", /DATABASE_URL/);
});

test("demo reset refuses a database it did not create", () => {
  assert.match(demoResetRefusal(ok, real) ?? "", /real deployment/);
  // A locally seeded database has users but no marker: also refused.
  assert.ok(demoResetRefusal(ok, { ...demo, demoMarker: false }));
});

test("demo reset allows an empty database or its own demo", () => {
  assert.equal(demoResetRefusal(ok, empty), null);
  assert.equal(demoResetRefusal(ok, null), null);
  assert.equal(demoResetRefusal(ok, demo), null);
});

test("seed refuses a database set up through /setup", () => {
  assert.match(seedRefusal(real) ?? "", /real deployment/);
  assert.equal(seedRefusal(empty), null);
  assert.equal(seedRefusal(demo), null);
  // Re-running the seed on a local dev database is still allowed.
  assert.equal(seedRefusal({ ...demo, demoMarker: false }), null);
});
