import Link from "next/link";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { applications, candidates, scorecards } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { canManageHiring } from "@/lib/permissions";
import { RECOMMENDATION_LABELS, summarize, type Recommendation } from "@/lib/scorecards";
import { moveCardAction } from "../actions";
import { Board, type BoardCard } from "./board";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const view = (await searchParams).view === "list" ? "list" : "board";
  const user = await requireUser();
  const manage = canManageHiring(user.role);
  const { job, stages } = await loadJob(user, id);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  const rows = await db()
    .select({
      id: applications.id,
      status: applications.status,
      stageId: applications.stageId,
      appliedAt: applications.appliedAt,
      stageChangedAt: applications.stageChangedAt,
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

  const active = rows.filter((r) => r.status === "active");
  const closedCounts = (["hired", "rejected", "withdrawn"] as const)
    .map((status) => ({ status, n: rows.filter((r) => r.status === status).length }))
    .filter((x) => x.n > 0);

  // Scorecard feedback for the board cards.
  const activeIds = active.map((r) => r.id);
  const feedback = activeIds.length
    ? await db()
        .select({ applicationId: scorecards.applicationId, recommendation: scorecards.recommendation })
        .from(scorecards)
        .where(inArray(scorecards.applicationId, activeIds))
    : [];
  function feedbackFor(applicationId: string): string | null {
    const recs = feedback.filter((f) => f.applicationId === applicationId).map((f) => f.recommendation as Recommendation);
    if (recs.length === 0) return null;
    // Interviewers only get a count here; the candidate page decides when they may see the rest.
    if (!manage) return `${recs.length} scorecard${recs.length === 1 ? "" : "s"}`;
    return summarize(recs)
      .reverse()
      .map((x) => `${x.count} ${RECOMMENDATION_LABELS[x.recommendation]}`)
      .join(", ");
  }

  const now = Date.now();
  const boardCards: BoardCard[] = active.map((r) => ({
    id: r.id,
    candidateId: r.candidateId,
    name: r.name,
    stageId: r.stageId,
    daysInStage: Math.max(0, Math.floor((now - r.stageChangedAt.getTime()) / DAY_MS)),
    feedback: feedbackFor(r.id),
  }));

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
        {manage && (
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

      <nav aria-label="View" className="mt-6 flex items-center gap-4 text-sm">
        <Link href={`/jobs/${job.id}`} aria-current={view === "board" ? "page" : undefined} className={view === "board" ? "font-semibold" : "link"}>
          Board
        </Link>
        <Link href={`/jobs/${job.id}?view=list`} aria-current={view === "list" ? "page" : undefined} className={view === "list" ? "font-semibold" : "link"}>
          List ({rows.length})
        </Link>
        {view === "board" && closedCounts.length > 0 && (
          <span className="muted">
            Not shown: {closedCounts.map((c) => `${c.n} ${c.status}`).join(", ")}
          </span>
        )}
      </nav>

      {view === "board" ? (
        <div className="mt-4">
          {stages.length === 0 && active.length === 0 ? (
            <p className="muted text-sm">This job has no stages. Add some on the edit page.</p>
          ) : (
            <Board
              stages={stages.map((s) => ({ id: s.id, name: s.name }))}
              cards={boardCards}
              canMove={manage}
              moveAction={moveCardAction}
            />
          )}
        </div>
      ) : rows.length === 0 ? (
        <p className="muted mt-4 text-sm">No applications yet.</p>
      ) : (
        <table className="table mt-4">
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
