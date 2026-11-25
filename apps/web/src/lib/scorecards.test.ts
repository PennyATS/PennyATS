import assert from "node:assert/strict";
import { test } from "node:test";
import { canSeeOthersScorecards, parseAttributes, parseScorecard, summarize } from "./scorecards";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const ATTRS = ["Problem solving", "Communication", "Ownership"];

test("parseScorecard maps ratings to attribute names and skips unassessed ones", () => {
  const result = parseScorecard(
    form({ "rating-0": "4", "rating-1": "", "rating-2": "2", recommendation: "yes", summary: "  Solid.  " }),
    ATTRS,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    ratings: { "Problem solving": 4, Ownership: 2 },
    recommendation: "yes",
    summary: "Solid.",
  });
});

test("parseScorecard drops out-of-range or non-integer ratings", () => {
  const result = parseScorecard(
    form({ "rating-0": "5", "rating-1": "0", "rating-2": "2.5", recommendation: "no" }),
    ATTRS,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value.ratings, {});
  assert.equal(result.value.summary, null);
});

test("parseScorecard requires a valid recommendation", () => {
  assert.equal(parseScorecard(form({ "rating-0": "3" }), ATTRS).ok, false);
  assert.equal(parseScorecard(form({ recommendation: "maybe" }), ATTRS).ok, false);
});

test("parseAttributes trims, drops blanks and case-insensitive duplicates, and caps at 12", () => {
  assert.deepEqual(parseAttributes(" Problem solving \n\nCommunication\r\nproblem SOLVING\n"), [
    "Problem solving",
    "Communication",
  ]);
  const many = Array.from({ length: 20 }, (_, i) => `Skill ${i}`).join("\n");
  assert.equal(parseAttributes(many).length, 12);
});

test("summarize counts recommendations in order and skips zeros", () => {
  assert.deepEqual(summarize(["yes", "strong_no", "yes"]), [
    { recommendation: "strong_no", count: 1 },
    { recommendation: "yes", count: 2 },
  ]);
  assert.deepEqual(summarize([]), []);
});

test("interviewers can't see other scorecards until they submit; recruiters always can", () => {
  assert.equal(canSeeOthersScorecards({ managesHiring: false, hasSubmitted: false }), false);
  assert.equal(canSeeOthersScorecards({ managesHiring: false, hasSubmitted: true }), true);
  assert.equal(canSeeOthersScorecards({ managesHiring: true, hasSubmitted: false }), true);
});
