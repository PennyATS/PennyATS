import { randomUUID } from "node:crypto";
import { SCHEMA_VERSION, type ExportDocument } from "@pennyats/schema";
import type { ImportRow } from "./candidate-import";

/** Adapt validated CSV rows to the open workspace format before using its importer. */
export function csvRowsToWorkspaceDocument(
  rows: ImportRow[],
  now = new Date(),
  makeId: () => string = randomUUID,
): ExportDocument {
  const timestamp = now.toISOString();
  const candidates: ExportDocument["candidates"] = rows.map((row) => ({
    id: makeId(),
    full_name: row.fullName,
    email: row.email,
    phone: row.phone,
    linkedin_url: row.linkedinUrl,
    location: row.location,
    source: row.source,
    tags: [],
    resume_name: null,
    resume_text: null,
    consented_at: null,
    created_at: timestamp,
  }));
  return {
    format: "pennyats-export",
    schema_version: SCHEMA_VERSION,
    exported_at: timestamp,
    people: [],
    jobs: [],
    candidates,
    applications: rows.map((row, index) => {
      const appliedAt = row.appliedAt?.toISOString() ?? timestamp;
      return {
        id: makeId(),
        candidate_id: candidates[index].id,
        job_id: row.jobId,
        stage_id: row.stageId,
        status: row.status,
        rejection_reason: null,
        applied_at: appliedAt,
        stage_changed_at: appliedAt,
        events: [],
        notes: [],
      };
    }),
    interviews: [],
    scorecards: [],
    notes: [],
  };
}
