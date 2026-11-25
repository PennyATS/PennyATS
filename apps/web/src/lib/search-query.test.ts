import assert from "node:assert/strict";
import { test } from "node:test";
import { likePattern, matchesText, parseQuery, positiveTerms } from "./search-query";

const match = (q: string, text: string) => matchesText(parseQuery(q), text);

test("bare words are ANDed", () => {
  assert.equal(match("python django", "Python and Django developer"), true);
  assert.equal(match("python django", "Python only"), false);
});

test("OR, NOT, minus, and parentheses", () => {
  const q = "python AND (django OR flask) -intern";
  assert.equal(match(q, "senior python flask engineer"), true);
  assert.equal(match(q, "python django intern"), false);
  assert.equal(match(q, "python rails"), false);
  assert.equal(match("NOT recruiter", "engineer"), true);
  assert.equal(match("NOT recruiter", "technical recruiter"), false);
  assert.equal(match("go || rust", "rust"), true);
});

test("quoted phrases match as a whole", () => {
  assert.equal(match('"machine learning"', "applied machine learning"), true);
  assert.equal(match('"machine learning"', "learning about machine shops"), false);
  assert.equal(match('-"cover letter"', "resume"), true);
});

test("malformed queries never throw", () => {
  for (const q of ["((python", "python))", "AND", "OR OR", "NOT", "()", '"unterminated', "-", ") python ("]) {
    assert.doesNotThrow(() => parseQuery(q));
  }
  assert.equal(parseQuery("AND OR NOT"), null);
  assert.equal(parseQuery("   "), null);
  assert.equal(match("((python", "python"), true);
  assert.equal(match("python) go", "python go"), true);
  assert.equal(match("python) go", "python"), false);
});

test("lowercase and/or are plain words", () => {
  assert.deepEqual(positiveTerms(parseQuery("research and development")), ["research", "and", "development"]);
});

test("term count is capped", () => {
  const q = Array.from({ length: 40 }, (_, i) => `t${i}`).join(" ");
  assert.equal(positiveTerms(parseQuery(q)).length, 20);
});

test("likePattern escapes wildcards", () => {
  assert.equal(likePattern("50%_a\\b"), "%50\\%\\_a\\\\b%");
});
