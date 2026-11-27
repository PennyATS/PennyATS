import Link from "next/link";
import { asc } from "drizzle-orm";
import { jobs, stages } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ImportCsvForm } from "./import-csv-form";

export default async function ImportCandidatesPage() {
  await requireUser("candidates.create");
  const [jobList, stageList] = await Promise.all([
    db().select({ id: jobs.id, title: jobs.title }).from(jobs).orderBy(asc(jobs.title)),
    db().select({ id: stages.id, jobId: stages.jobId, name: stages.name, position: stages.position }).from(stages),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/candidates" className="link text-sm">← Candidates</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Import candidates</h1>
        <p className="muted mt-1 text-sm">Upload a Greenhouse or generic CSV, map its columns, review the rows, then import. Email is required to prevent duplicates.</p>
      </div>
      <ImportCsvForm jobs={jobList} stages={stageList} />
    </div>
  );
}
