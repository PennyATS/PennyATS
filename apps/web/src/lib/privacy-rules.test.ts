import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PRIVACY, parsePrivacyForm, readPrivacySettings, retentionCutoff } from "./privacy-rules";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test("stored settings fall back to safe defaults when missing or malformed", () => {
  assert.deepEqual(readPrivacySettings(undefined), DEFAULT_PRIVACY);
  assert.deepEqual(readPrivacySettings({ retentionMonths: -3, noticeUrl: "javascript:alert(1)", requireConsent: "yes" }), DEFAULT_PRIVACY);
  assert.equal(readPrivacySettings({ retentionMonths: 24 }).retentionMonths, 24);
});

test("the form accepts blank retention as 'never' and rejects bad values", () => {
  const ok = parsePrivacyForm(form({ noticeText: "We keep data 2 years.", retentionMonths: "" }));
  assert.ok(ok.ok);
  assert.equal(ok.value.retentionMonths, null);
  assert.equal(parsePrivacyForm(form({ retentionMonths: "0" })).ok, false);
  assert.equal(parsePrivacyForm(form({ retentionMonths: "1.5" })).ok, false);
  assert.equal(parsePrivacyForm(form({ retentionMonths: "500" })).ok, false);
  assert.equal(parsePrivacyForm(form({ noticeUrl: "ftp://example.com" })).ok, false);
});

test("consent can't be required without something to consent to", () => {
  assert.equal(parsePrivacyForm(form({ requireConsent: "on" })).ok, false);
  const ok = parsePrivacyForm(form({ requireConsent: "on", noticeUrl: "https://example.com/privacy" }));
  assert.ok(ok.ok);
  assert.equal(ok.value.requireConsent, true);
});

test("retention cutoff is N calendar months before now", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  assert.equal(retentionCutoff(24, now).toISOString(), "2024-11-24T12:00:00.000Z");
  assert.equal(retentionCutoff(1, now).toISOString(), "2026-10-24T12:00:00.000Z");
});
