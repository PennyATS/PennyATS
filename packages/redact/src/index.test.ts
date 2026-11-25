import assert from "node:assert/strict";
import { test } from "node:test";
import { createRedactor, redact, restore } from "./index";

test("emails, phone numbers and links are replaced and can be restored", () => {
  const input = "Reach Sam at sam@example.com or (555) 010-0199. Portfolio: https://example.com/sam";
  const { text, map } = redact(input);
  assert.equal(text, "Reach Sam at [EMAIL_1] or [PHONE_1]. Portfolio: [URL_1]");
  assert.equal(restore(text, map), input);
});

test("the same value gets the same placeholder", () => {
  const { text } = redact("a@example.com, b@example.com, a@example.com");
  assert.equal(text, "[EMAIL_1], [EMAIL_2], [EMAIL_1]");
});

test("one redactor numbers across several texts, so placeholders never mean two values", () => {
  const r = createRedactor();
  const system = r.redact("Hiring manager: lee@example.com");
  const prompt = r.redact("Candidate: jordan@example.com");
  assert.equal(system, "Hiring manager: [EMAIL_1]");
  assert.equal(prompt, "Candidate: [EMAIL_2]");
  assert.equal(
    restore("Email [EMAIL_2], cc [EMAIL_1]", r.map),
    "Email jordan@example.com, cc lee@example.com",
  );
});

test("names are not redacted (documented limitation)", () => {
  assert.equal(redact("Jordan Lee").text, "Jordan Lee");
});
