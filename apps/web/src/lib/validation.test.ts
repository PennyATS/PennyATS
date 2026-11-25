import assert from "node:assert/strict";
import { test } from "node:test";
import { checkResume, isEmail, isUuid, normalizeEmail, parseCandidate, slugify } from "./validation";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test("emails are trimmed and lowercased so one person maps to one candidate", () => {
  assert.equal(normalizeEmail("  Jordan.Lee@Example.COM "), "jordan.lee@example.com");
  assert.equal(isEmail("jordan@example.com"), true);
  assert.equal(isEmail("jordan@localhost"), false);
  assert.equal(isEmail("not an email"), false);
});

test("slugify makes URL-safe slugs", () => {
  assert.equal(slugify("Senior Software Engineer"), "senior-software-engineer");
  assert.equal(slugify("  Café / Barista (Part-time)!! "), "cafe-barista-part-time");
  assert.equal(slugify("!!!"), "job");
});

test("parseCandidate requires name, and email only when asked", () => {
  assert.deepEqual(parseCandidate(form({ email: "a@example.com" }), { requireEmail: true }), {
    ok: false,
    error: "Name is required.",
  });
  assert.equal(parseCandidate(form({ fullName: "Sam" }), { requireEmail: true }).ok, false);
  assert.equal(parseCandidate(form({ fullName: "Sam" }), { requireEmail: false }).ok, true);
});

test("parseCandidate normalizes email and rejects non-http LinkedIn links", () => {
  const ok = parseCandidate(form({ fullName: " Sam Rivera ", email: "SAM@Example.com" }), {
    requireEmail: true,
  });
  assert.ok(ok.ok);
  assert.equal(ok.value.fullName, "Sam Rivera");
  assert.equal(ok.value.email, "sam@example.com");
  assert.equal(ok.value.phone, null);

  const bad = parseCandidate(form({ fullName: "Sam", linkedinUrl: "javascript:alert(1)" }), {
    requireEmail: false,
  });
  assert.equal(bad.ok, false);
});

test("checkResume enforces type and size", () => {
  assert.equal(checkResume("resume.PDF", 1000), null);
  assert.match(checkResume("resume.exe", 1000) ?? "", /must be one of/);
  assert.match(checkResume("resume.pdf", 6 * 1024 * 1024) ?? "", /5 MB/);
  assert.match(checkResume("resume.pdf", 0) ?? "", /empty/);
});

test("isUuid guards route params", () => {
  assert.equal(isUuid("2f1b6f0e-8a5e-4d2b-9c4e-1a2b3c4d5e6f"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("2f1b6f0e-8a5e-4d2b-9c4e-1a2b3c4d5e6f' or 1=1"), false);
});
