import assert from "node:assert/strict";
import { test } from "node:test";
import { createRateLimiter } from "./rate-limit";

test("allows up to the limit per window, then blocks", () => {
  const allow = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(allow("ip", 0), true);
  assert.equal(allow("ip", 10), true);
  assert.equal(allow("ip", 20), false);
});

test("the window resets, and keys are counted separately", () => {
  const allow = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 500), false);
  assert.equal(allow("b", 500), true);
  assert.equal(allow("a", 1000), true);
});
