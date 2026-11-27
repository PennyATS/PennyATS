import assert from "node:assert/strict";
import { test } from "node:test";
import { guessImportMapping, parseImportCsv, planCandidateImport } from "./candidate-import";

const jobs = [{ id: "job-1", title: "Software Engineer" }];
const stages = [{ id: "stage-1", jobId: "job-1", name: "Phone Screen", position: 0 }];

test("Greenhouse-style headers map and quoted records retain line breaks", () => {
  const csv = parseImportCsv('\uFEFFFirst Name,Last Name,Email Address,Job Title,Current Stage,Source\r\n"Ada","Lovelace",ada@example.com,Software Engineer,Phone Screen,"Referral, event\nfollow-up"\r\n');
  const mapping = guessImportMapping(csv.headers);
  assert.equal(mapping.email, "Email Address");
  assert.equal(mapping.job, "Job Title");
  const plan = planCandidateImport({ csv, mapping, fallbackJobId: "", jobs, stages });
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.rows[0].fullName, "Ada Lovelace");
  assert.equal(plan.rows[0].stageId, "stage-1");
  assert.equal(plan.rows[0].source, "Referral, event\nfollow-up");
});

test("duplicate rows are skipped and invalid rows are reported", () => {
  const csv = parseImportCsv("Name,Email,Status,Applied On\nAda, ADA@example.com,active,11/25/2026\nAda,ada@example.com,active,11/25/2026\nBob,bad-address,rejected,2026-11-25\n");
  const plan = planCandidateImport({ csv, mapping: guessImportMapping(csv.headers), fallbackJobId: "job-1", jobs, stages });
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.duplicateRows, [3]);
  assert.deepEqual(plan.errors.map((error) => error.number), [4]);
  assert.equal(plan.rows[0].email, "ada@example.com");
  assert.equal(plan.rows[0].stageId, "stage-1");
  assert.equal(plan.rows[0].appliedAt?.toISOString(), "2026-11-25T00:00:00.000Z");
});

test("malformed CSV and unknown jobs cannot be imported", () => {
  assert.throws(() => parseImportCsv('Name,Email\n"Ada,ada@example.com'), /unclosed quoted/);
  const csv = parseImportCsv("Name,Email,Job\nAda,ada@example.com,Unknown\n");
  const plan = planCandidateImport({ csv, mapping: guessImportMapping(csv.headers), fallbackJobId: "", jobs, stages });
  assert.match(plan.errors[0].message, /not found uniquely/);
});

test("ISO timestamps preserve the original application instant", () => {
  const csv = parseImportCsv("Candidate,Email,Applied At\nAda,ada@example.com,2024-04-02T09:30:00-07:00\n");
  const plan = planCandidateImport({ csv, mapping: guessImportMapping(csv.headers), fallbackJobId: "job-1", jobs, stages });
  assert.equal(plan.rows[0].appliedAt?.toISOString(), "2024-04-02T16:30:00.000Z");
});
