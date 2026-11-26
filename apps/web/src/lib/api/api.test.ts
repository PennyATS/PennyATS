import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { retryDelayMs, signWebhook, verifyWebhook } from "../webhooks";
import { decodeCursor, encodeCursor } from "./data";
import { agentName } from "./handler";
import { bearerToken, generateApiKey, hashApiKey, keyUsable, parseApiKey } from "./keys";
import { openApiText } from "./openapi";
import { ROUTE_LIST, routes } from "./routes";
import { checkAccess, normalizeScopes, roleHasPermission, SCOPE_PERMISSIONS, SCOPES, scopesForRole } from "./scopes";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "../../../../..");
const apiDir = join(here, "../../app/api/v1");

/* ---------- Spec drift ---------- */

test("docs/api/openapi.json matches the code (run `pnpm api:spec` to update it)", () => {
  const committed = readFileSync(join(repoRoot, "docs/api/openapi.json"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(committed, openApiText(), "The committed OpenAPI document is out of date. Run `pnpm api:spec` and commit the result.");
});

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

test("every route table entry has a handler at its path, and every handler is in the table", () => {
  const found = new Set<string>();
  for (const file of routeFiles(apiDir)) {
    const rel = relative(apiDir, file).split(sep).slice(0, -1);
    // Meta routes outside the table: the spec itself and the JSON 404 fallback.
    if (rel[0] === "openapi.json" || rel[0] === "[...path]") continue;
    const path = "/" + rel.map((part) => part.replace(/^\[(.+)\]$/, "{$1}")).join("/");
    const source = readFileSync(file, "utf8");
    const exports = [...source.matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\s*=\s*apiHandler\(routes\.(\w+)/g)];
    assert.ok(exports.length > 0, `${file} should export handlers built with apiHandler(routes.x, ...)`);
    for (const [, method, name] of exports) {
      const route = routes[name as keyof typeof routes];
      assert.ok(route, `${file} uses routes.${name}, which isn't in the route table`);
      assert.equal(route.method, method, `routes.${name} is ${route.method} but ${file} exports it as ${method}`);
      assert.equal(route.path, path, `routes.${name} says ${route.path} but its file is at ${path}`);
      found.add(name);
    }
  }
  const missing = Object.keys(routes).filter((name) => !found.has(name));
  assert.deepEqual(missing, [], `Route table entries without a handler: ${missing.join(", ")}`);
});

test("operation ids are unique and every write is audited", () => {
  const ids = ROUTE_LIST.map((r) => r.operationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of ROUTE_LIST) {
    if (r.method !== "GET" && r.operationId !== "draftEmail") assert.ok(r.audit, `${r.operationId} changes data and must be audited`);
  }
});

/* ---------- Scopes and permissions ---------- */

test("a request needs both the scope and the user's permission", () => {
  assert.deepEqual(checkAccess({ scopes: ["jobs:read"], role: "interviewer" }, { scope: "jobs:read", permission: "jobs.view" }), { ok: true });
  assert.equal(
    (checkAccess({ scopes: [], role: "admin" }, { scope: "jobs:read", permission: "jobs.view" }) as { code: string }).code,
    "missing_scope",
  );
  assert.equal(
    (checkAccess({ scopes: ["applications:write"], role: "interviewer" }, { scope: "applications:write", permission: "applications.move" }) as {
      code: string;
    }).code,
    "forbidden",
  );
});

test("roles map onto permissions the same way the app's role checks do", () => {
  for (const scope of SCOPES) {
    for (const p of SCOPE_PERMISSIONS[scope]) assert.ok(roleHasPermission("admin", p), `admin should have ${p}`);
  }
  assert.equal(roleHasPermission("recruiter", "privacy.delete"), false);
  assert.equal(roleHasPermission("recruiter", "applications.move"), true);
  assert.equal(roleHasPermission("interviewer", "applications.move"), false);
  assert.equal(roleHasPermission("interviewer", "notes.write"), true);
  assert.equal(roleHasPermission("interviewer", "scorecards.submit"), true);
  assert.equal(roleHasPermission("interviewer", "reports.view"), false);
  assert.equal(roleHasPermission("interviewer", "email.send"), false);
});

test("an interviewer key can only hold scopes the role can use", () => {
  const scopes = scopesForRole("interviewer");
  assert.ok(scopes.includes("notes:write"));
  assert.ok(scopes.includes("scorecards:write"));
  assert.ok(!scopes.includes("applications:write"));
  assert.ok(!scopes.includes("candidates:delete"));
  assert.ok(!scopesForRole("recruiter").includes("candidates:delete"));
  assert.deepEqual(scopesForRole("admin"), [...SCOPES]);
});

test("scopes are de-duplicated, validated, and kept in canonical order", () => {
  assert.deepEqual(normalizeScopes(["notes:read", "bogus", "jobs:read", "notes:read", 3]), ["jobs:read", "notes:read"]);
});

/* ---------- Keys ---------- */

test("keys have a visible prefix and are stored only as a hash", () => {
  const { key, prefix, hash } = generateApiKey();
  assert.match(key, /^pats_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
  assert.equal(parseApiKey(key)?.prefix, prefix);
  assert.equal(hash, hashApiKey(key));
  assert.equal(hash.length, 64);
  assert.equal(parseApiKey("pats_short"), null);
  assert.equal(parseApiKey(`${key}x`), null);
  assert.notEqual(generateApiKey().key, key);
});

test("revoked and expired keys can't be used", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  assert.equal(keyUsable({ revokedAt: null, expiresAt: null }, now), "ok");
  assert.equal(keyUsable({ revokedAt: null, expiresAt: new Date("2026-12-01T00:00:00Z") }, now), "ok");
  assert.equal(keyUsable({ revokedAt: null, expiresAt: new Date("2026-11-26T11:59:59Z") }, now), "expired");
  assert.equal(keyUsable({ revokedAt: new Date("2026-11-01T00:00:00Z"), expiresAt: null }, now), "revoked");
});

test("bearer tokens are read from the Authorization header only", () => {
  assert.equal(bearerToken("Bearer abc"), "abc");
  assert.equal(bearerToken("bearer   abc  "), "abc");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken(null), null);
});

test("agent names are trimmed and stripped of markup", () => {
  assert.equal(agentName("pennyats-mcp/0.1 (Claude)"), "pennyats-mcp/0.1 Claude");
  assert.equal(agentName("<script>"), "script");
  assert.equal(agentName("   "), null);
  assert.equal(agentName(null), null);
  assert.equal(agentName("x".repeat(100))?.length, 60);
});

/* ---------- Pagination ---------- */

test("cursors round-trip and reject tampering", () => {
  const at = new Date("2026-11-20T10:00:00.123Z");
  const id = "0b9f6f0e-1d2c-4c41-9b1a-0d6b2f1f7a10";
  assert.deepEqual(decodeCursor(encodeCursor(at, id)), { at: at.toISOString(), id });
  assert.equal(decodeCursor(undefined), null);
  assert.throws(() => decodeCursor("not-a-cursor"));
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify(["x", id])).toString("base64url")));
  assert.throws(() => decodeCursor(Buffer.from(JSON.stringify([at.toISOString(), "1; drop table"])).toString("base64url")));
});

/* ---------- Webhooks ---------- */

test("webhook signatures verify, and tampered or stale ones don't", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "e1", type: "application.created" });
  const t = 1_800_000_000;
  const header = signWebhook(secret, body, t);
  assert.match(header, /^t=1800000000,v1=[0-9a-f]{64}$/);
  assert.ok(verifyWebhook(secret, body, header, { now: t + 10 }));
  assert.ok(!verifyWebhook(secret, `${body} `, header, { now: t }));
  assert.ok(!verifyWebhook("whsec_other", body, header, { now: t }));
  assert.ok(!verifyWebhook(secret, body, header, { now: t + 301 }));
  assert.ok(!verifyWebhook(secret, body, "t=abc,v1=00", { now: t }));
});

test("webhook retries back off exponentially and are capped", () => {
  assert.equal(retryDelayMs(1, 30_000), 30_000);
  assert.equal(retryDelayMs(2, 30_000), 60_000);
  assert.equal(retryDelayMs(4, 30_000), 240_000);
  assert.equal(retryDelayMs(30, 30_000), 6 * 60 * 60 * 1000);
});
