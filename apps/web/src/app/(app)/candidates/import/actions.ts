"use server";

import { asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { jobs, stages } from "@pennyats/db";
import { importWorkspace } from "@pennyats/schema";
import { requireUser } from "@/lib/auth";
import { CSV_MAX_BYTES, importFields, parseImportCsv, planCandidateImport, type ImportMapping, type RowError } from "@/lib/candidate-import";
import { csvRowsToWorkspaceDocument } from "@/lib/candidate-import-format";
import { db } from "@/lib/db";
import { canManageHiring } from "@/lib/permissions";
import { logAudit } from "@/lib/privacy";

export type ImportResult = {
  created: number;
  skipped: number;
  errors: RowError[];
} | { error: string };

export async function importCandidatesAction(form: FormData): Promise<ImportResult> {
  const user = await requireUser(canManageHiring);
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".csv") || !file.size || file.size > CSV_MAX_BYTES) {
    return { error: "Choose a non-empty CSV file no larger than 2 MB." };
  }
  const mapping = Object.fromEntries(importFields.map((field) => [
    field, typeof form.get(`map:${field}`) === "string" ? form.get(`map:${field}`) : "",
  ])) as ImportMapping;
  const fallbackJobId = typeof form.get("fallbackJobId") === "string" ? String(form.get("fallbackJobId")) : "";
  try {
    const csv = parseImportCsv(await file.text());
    const [jobList, stageList] = await Promise.all([
      db().select({ id: jobs.id, title: jobs.title }).from(jobs).orderBy(asc(jobs.title)),
      db().select({ id: stages.id, jobId: stages.jobId, name: stages.name, position: stages.position }).from(stages),
    ]);
    const plan = planCandidateImport({ csv, mapping, fallbackJobId, jobs: jobList, stages: stageList });
    const errors = [...plan.errors];
    if (!plan.rows.length) return { created: 0, skipped: plan.duplicateRows.length, errors };
    // The open-format importer owns email matching, idempotency, and database writes.
    const summary = await importWorkspace(db(), csvRowsToWorkspaceDocument(plan.rows)).catch(() => null);
    if (!summary) return { error: "Import failed; no rows were written. Check the server and try again." };
    const created = summary.created.applications;
    const skipped = plan.duplicateRows.length + summary.skipped_existing.applications;
    await logAudit("workspace_imported", user.id, {
      via: "csv",
      created_candidates: summary.created.candidates,
      merged_candidates: summary.merged_candidates,
      created_applications: created,
      skipped_applications: skipped,
    });
    if (created) {
      revalidatePath("/candidates");
      for (const jobId of new Set(plan.rows.map((row) => row.jobId))) revalidatePath(`/jobs/${jobId}`);
    }
    return { created, skipped, errors: errors.sort((a, b) => a.number - b.number) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "CSV could not be imported." };
  }
}
