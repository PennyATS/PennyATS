"use server";

import { asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { jobs, stages } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { CSV_MAX_BYTES, importFields, parseImportCsv, planCandidateImport, type ImportMapping, type RowError } from "@/lib/candidate-import";
import { db } from "@/lib/db";
import { addApplication } from "@/lib/hiring";
import { canManageHiring } from "@/lib/permissions";

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
      db().select({ id: stages.id, jobId: stages.jobId, name: stages.name }).from(stages),
    ]);
    const plan = planCandidateImport({ csv, mapping, fallbackJobId, jobs: jobList, stages: stageList });
    const errors = [...plan.errors];
    let created = 0;
    let skipped = plan.duplicateRows.length;
    for (const row of plan.rows) {
      try {
        const result = await db().transaction((tx) => addApplication(tx, {
          jobId: row.jobId,
          candidate: {
            fullName: row.fullName,
            email: row.email,
            phone: row.phone,
            linkedinUrl: row.linkedinUrl,
            location: row.location,
            source: row.source,
          },
          initialStageId: row.stageId,
          initialStatus: row.status,
          appliedAt: row.appliedAt ?? undefined,
          actorId: user.id,
          notifyWatchers: false,
        }));
        if (result.created) created++;
        else skipped++;
      } catch {
        errors.push({ number: row.number, message: "Database rejected this row. Check its values and retry." });
      }
    }
    if (created) {
      revalidatePath("/candidates");
      for (const jobId of new Set(plan.rows.map((row) => row.jobId))) revalidatePath(`/jobs/${jobId}`);
    }
    return { created, skipped, errors: errors.sort((a, b) => a.number - b.number) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "CSV could not be imported." };
  }
}
