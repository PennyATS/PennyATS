import assert from "node:assert/strict";
import { test } from "node:test";
import { openSchedulingBody, sealSchedulingBody } from "./scheduling-secrets";

test("scheduling mail is encrypted at rest and tampering is rejected", () => {
  const before = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "test-secret-for-scheduling-mail";
  try {
    const body = "Candidate booking link: https://example.test/book/private-token";
    const sealed = sealSchedulingBody(body);
    assert.equal(sealed.includes("private-token"), false);
    assert.equal(openSchedulingBody(sealed), body);
    const parts = sealed.split(".");
    parts[2] = Buffer.from("changed").toString("base64url");
    assert.throws(() => openSchedulingBody(parts.join(".")));
  } finally {
    if (before === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = before;
  }
});
