import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExport } from "@pennyats/schema";
import { csvRowsToWorkspaceDocument } from "./candidate-import-format";
import type { ImportRow } from "./candidate-import";

test("mapped CSV rows produce a valid open-format document with preserved application state", () => {
  const row: ImportRow = {
    number: 2,
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: null,
    linkedinUrl: null,
    location: null,
    source: "Greenhouse",
    jobId: "00000000-0000-4000-8000-000000000001",
    jobTitle: "Engineer",
    stageId: "00000000-0000-4000-8000-000000000002",
    stageName: "Screen",
    status: "hired",
    appliedAt: new Date("2024-04-02T16:30:00.000Z"),
  };
  const ids = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"];
  const doc = parseExport(csvRowsToWorkspaceDocument([row], new Date("2026-11-27T00:00:00.000Z"), () => ids.shift()!));
  assert.equal(doc.candidates[0].email, row.email);
  assert.equal(doc.applications[0].candidate_id, doc.candidates[0].id);
  assert.equal(doc.applications[0].stage_id, row.stageId);
  assert.equal(doc.applications[0].status, "hired");
  assert.equal(doc.applications[0].applied_at, "2024-04-02T16:30:00.000Z");
  assert.deepEqual(doc.applications[0].events, []);
});
