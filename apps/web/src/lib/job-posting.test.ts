import assert from "node:assert/strict";
import { test } from "node:test";
import { buildJobPosting, jobPostingJsonLd, type JobPostingInput } from "./job-posting";

const base: JobPostingInput = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "staff-engineer",
  title: "Staff Engineer",
  description: "Build the hiring product.\n<script>alert(1)</script>",
  location: "San Francisco, CA",
  employmentType: "full_time",
  workplaceType: "hybrid",
  createdAt: new Date("2026-03-01T12:00:00.000Z"),
  compPublic: true,
  compCurrency: "USD",
  compPeriod: "year",
  compMin: 180000,
  compMax: 220000,
};

const ctx = { companyName: "Acme", appUrl: "https://careers.acme.com/" };

test("includes Google's required JobPosting fields", () => {
  const p = buildJobPosting(base, ctx);
  assert.equal(p["@type"], "JobPosting");
  assert.equal(p.title, "Staff Engineer");
  assert.equal(p.datePosted, "2026-03-01");
  assert.equal((p.hiringOrganization as { name: string }).name, "Acme");
  assert.equal(p.employmentType, "FULL_TIME");
  assert.equal(p.jobLocationType, "TELECOMMUTE");
  assert.equal(p.url, "https://careers.acme.com/careers/staff-engineer");
  assert.equal(p.directApply, true);
  const loc = p.jobLocation as { address: { addressLocality: string } };
  assert.equal(loc.address.addressLocality, "San Francisco, CA");
  const salary = p.baseSalary as { currency: string; value: { minValue: number; maxValue: number; unitText: string } };
  assert.equal(salary.currency, "USD");
  assert.equal(salary.value.minValue, 180000);
  assert.equal(salary.value.maxValue, 220000);
  assert.equal(salary.value.unitText, "YEAR");
});

test("omits pay when not public and maps remote roles", () => {
  const p = buildJobPosting(
    { ...base, compPublic: false, workplaceType: "remote", location: "United States", employmentType: null },
    ctx,
  );
  assert.equal(p.baseSalary, undefined);
  assert.equal(p.employmentType, undefined);
  assert.equal(p.jobLocationType, "TELECOMMUTE");
  assert.equal((p.applicantLocationRequirements as { name: string }).name, "United States");
});

test("falls back description to title and escapes script breakout in JSON-LD", () => {
  const p = buildJobPosting({ ...base, description: "   " }, ctx);
  assert.equal(p.description, "Staff Engineer");
  const json = jobPostingJsonLd(base, ctx);
  assert.ok(!json.includes("<script>"));
  assert.ok(json.includes("\\u003cscript>"));
  assert.deepEqual(JSON.parse(json), buildJobPosting(base, ctx));
});
