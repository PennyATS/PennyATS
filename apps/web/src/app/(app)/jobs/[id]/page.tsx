import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { applications, candidates } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { canManageHiring } from "@/lib/permissions";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const { job, stages } = await loadJob(user, id);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  const rows = await db()
    .select({
      id: applications.id,
      status: applications.status,
      stageId: applications.stageId,
      appliedAt: applications.appliedAt,
      candidateId: candidates.id,
      name: candidates.fullName,
      email: candidates.email,
      source: candidates.source,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(eq(applications.jobId, job.id))
    // Active first, newest first within each status.
    .orderBy(asc(applications.status), desc(applications.appliedAt));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
          <p className="muted mt-1 text-sm">
            {[job.department, job.location].filter(Boolean).join(" · ")}
            {" · "}
            <span className="capitalize">{job.status}</span>
            {job.status === "open" && (
              <>
                {" · "}
                <Link href={`/careers/${job.slug}`} className="link">
                  Careers page
                </Link>
              </>
            )}
          </p>
        </div>
        {canManageHiring(user.role) && (
          <div className="flex gap-2">
            <Link href={`/jobs/${job.id}/add-candidate`} className="btn">
              Add candidate
            </Link>
            <Link href={`/jobs/${job.id}/edit`} className="btn btn-secondary">
              Edit job
            </Link>
          </div>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Applications ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="muted mt-2 text-sm">No applications yet.</p>
      ) : (
        <table className="table mt-3">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Source</th>
              <th>Applied</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/candidates/${r.candidateId}`} className="link">
                    {r.name}
                  </Link>
                  {r.email && <div className="muted text-xs">{r.email}</div>}
                </td>
                <td>{r.stageId ? stageName.get(r.stageId) : "-"}</td>
                <td className="capitalize">{r.status}</td>
                <td>{r.source}</td>
                <td>{r.appliedAt.toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
