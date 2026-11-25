import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REJECTION_REASONS,
  mergeTags,
  normalizeTag,
  parseTags,
  pipelineSnapshot,
  rejectionReasonKey,
  rejectionReasonText,
} from "./candidate-review";

test("normalizeTag lowercases, strips #, and hyphenates spaces", () => {
  assert.equal(normalizeTag("#SWE"), "swe");
  assert.equal(normalizeTag("  Bay Area "), "bay-area");
  assert.equal(normalizeTag("##c++"), "c++");
  assert.equal(normalizeTag("node.js"), "node.js");
  assert.equal(normalizeTag("<script>"), "script");
  assert.equal(normalizeTag("#"), null);
  assert.equal(normalizeTag("   "), null);
});

test("parseTags splits on commas or hashtags and dedupes", () => {
  assert.deepEqual(parseTags("#swe #bayarea #SWE"), ["swe", "bayarea"]);
  assert.deepEqual(parseTags("bay area, senior, Bay Area"), ["bay-area", "senior"]);
  assert.deepEqual(parseTags("swe swe"), ["swe"]);
});

test("mergeTags keeps existing order and caps the count", () => {
  assert.deepEqual(mergeTags(["swe"], ["#SWE", "remote"]), ["swe", "remote"]);
  const many = Array.from({ length: 50 }, (_, i) => `t${i}`);
  assert.equal(mergeTags([], many).length, 30);
});

test("rejection reasons must come from the standard list", () => {
  assert.equal(rejectionReasonText("Not a reason", null), null);
  assert.equal(rejectionReasonText(null, "note"), null);
  assert.equal(rejectionReasonText("Compensation mismatch", "  "), "Compensation mismatch");
  assert.equal(rejectionReasonText("Other", "Moved abroad"), "Other — Moved abroad");
  assert.ok(REJECTION_REASONS.includes("Potentially fraudulent application"));
});

test("rejectionReasonKey groups a reason with its note", () => {
  assert.equal(rejectionReasonKey("Compensation mismatch — wants 200k"), "Compensation mismatch");
  assert.equal(rejectionReasonKey("Free text — from before"), "Free text — from before");
});

test("pipelineSnapshot uses a fixed order and rolls up other stages", () => {
  const rows = pipelineSnapshot([
    { name: "Offer", total: 2 },
    { name: "Hiring manager screen", total: 5 },
    { name: "applied", total: 10 },
    { name: "Applied", total: 3 },
    { name: "Onsite", total: 1 },
    { name: null, total: 4 },
  ]);
  assert.deepEqual(rows, [
    { label: "Applied", total: 13 },
    { label: "Recruiter screen", total: 0 },
    { label: "Technical interview", total: 0 },
    { label: "Onsite", total: 1 },
    { label: "Other stages", total: 9 },
    { label: "Offer", total: 2 },
  ]);
});
