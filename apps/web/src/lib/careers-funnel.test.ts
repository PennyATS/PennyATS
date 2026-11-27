import assert from "node:assert/strict";
import { test } from "node:test";
import { careersApplyFunnel, isCareersFunnelKind, tallyCareersFunnel } from "./careers-funnel";

test("careersApplyFunnel percents are of views", () => {
  assert.deepEqual(careersApplyFunnel({ views: 100, starts: 40, submits: 10 }), [
    { label: "Views", count: 100, percent: 100 },
    { label: "Starts", count: 40, percent: 40 },
    { label: "Submits", count: 10, percent: 10 },
  ]);
  assert.deepEqual(careersApplyFunnel({ views: 0, starts: 0, submits: 0 }), [
    { label: "Views", count: 0, percent: 0 },
    { label: "Starts", count: 0, percent: 0 },
    { label: "Submits", count: 0, percent: 0 },
  ]);
});

test("tallyCareersFunnel sums known kinds and ignores others", () => {
  assert.deepEqual(
    tallyCareersFunnel([
      { kind: "view", count: 3 },
      { kind: "start", count: 2 },
      { kind: "submit", count: 1 },
      { kind: "view", count: 1 },
      { kind: "other", count: 9 },
    ]),
    { views: 4, starts: 2, submits: 1 },
  );
  assert.equal(isCareersFunnelKind("start"), true);
  assert.equal(isCareersFunnelKind("click"), false);
});
