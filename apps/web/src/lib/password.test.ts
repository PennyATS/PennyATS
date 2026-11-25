import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { isResetToken, readPassword } from "./password";

function passwordForm(password: string, confirm = password): FormData {
  const form = new FormData();
  form.set("password", password);
  form.set("confirm", confirm);
  return form;
}

test("password validation rejects short, mismatched, and oversized values", () => {
  assert.ok("error" in readPassword(passwordForm("short")));
  assert.ok("error" in readPassword(passwordForm("long-enough", "different")));
  assert.ok("error" in readPassword(passwordForm("a".repeat(201))));
  assert.deepEqual(readPassword(passwordForm("long-enough")), { password: "long-enough" });
});

test("reset links use 32-byte base64url tokens", () => {
  const token = randomBytes(32).toString("base64url");
  assert.equal(isResetToken(token), true);
  assert.equal(isResetToken(token.slice(1)), false);
  assert.equal(isResetToken(`${token}/`), false);
});
