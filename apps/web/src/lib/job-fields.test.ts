import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCompensation, parseAmount, parseJobDetails } from "./job-fields";

function parse(values: Record<string, string>, checks: string[] = []) {
  return parseJobDetails((name) => values[name]?.trim() || null, (name) => checks.includes(name));
}

test("parseAmount accepts common salary formats", () => {
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount("120,000"), 120000);
  assert.equal(parseAmount("$120k"), 120000);
  assert.equal(parseAmount("95.5"), 96);
  assert.ok(Number.isNaN(parseAmount("lots")));
});

test("nothing is required", () => {
  const r = parse({});
  assert.ok("value" in r);
  if ("value" in r) {
    assert.equal(r.value.compMin, null);
    assert.equal(r.value.compCurrency, null);
    assert.equal(r.value.confidential, false);
  }
});

test("midpoint fills in and currency defaults when a range is given", () => {
  const r = parse({ compMin: "100k", compMax: "140k" }, ["compPublic"]);
  assert.ok("value" in r && r.value.compMid === 120000 && r.value.compCurrency === "USD" && r.value.compPeriod === "year" && r.value.compPublic);
});

test("rejects impossible ranges and bad numbers", () => {
  assert.deepEqual(parse({ compMin: "150k", compMax: "100k" }), { error: "Minimum compensation is above the maximum." });
  assert.ok("error" in parse({ compMin: "100k", compMid: "200k", compMax: "150k" }));
  assert.ok("error" in parse({ compMax: "a lot" }));
});

test("unknown choices and malformed ids are dropped", () => {
  const r = parse({ employmentType: "forever", hiringManagerId: "1; drop table", targetStartDate: "2026-13-45", priority: "urgent" });
  assert.ok("value" in r);
  if ("value" in r) {
    assert.equal(r.value.employmentType, null);
    assert.equal(r.value.hiringManagerId, null);
    assert.equal(r.value.targetStartDate, null);
    assert.equal(r.value.priority, "urgent");
  }
});

test("formatCompensation", () => {
  assert.equal(formatCompensation({ compCurrency: "USD", compPeriod: "year", compMin: 120000, compMax: 150000 }), "$120,000 – $150,000 per year");
  assert.equal(formatCompensation({ compCurrency: "EUR", compPeriod: "hour", compMin: 50, compMax: null }), "From €50 per hour");
  assert.equal(formatCompensation({ compCurrency: null, compPeriod: null, compMin: null, compMax: null }), null);
});
