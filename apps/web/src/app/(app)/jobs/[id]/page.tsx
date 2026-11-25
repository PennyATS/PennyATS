import Link from "next/link";
import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { applications, candidates, interviewInterviewers, interviews, jobTeam, scorecards, users } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { daysSince, jobHealth, weeklyApplicants } from "@/lib/job-health";
import { isOverdue, missingFeedback } from "@/lib/interviews";
import { canManageHiring } from "@/lib/permissions";
import { loadReportInput } from "@/lib/report-data";
import { reportTables } from "@/lib/reports";
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
  const requested = (await searchParams).view;
  const view = requested === "board" || requested === "list" ? requested : "overview";
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

  // Scorecards on this job: board card summaries and the overview's feedback check.
  const feedback = await db()
    .select({
      applicationId: scorecards.applicationId,
      recommendation: scorecards.recommendation,
      stageName: scorecards.stageName,
      interviewId: scorecards.interviewId,
      authorId: scorecards.authorId,
    })
    .from(scorecards)
    .innerJoin(applications, eq(applications.id, scorecards.applicationId))
    .where(eq(applications.jobId, job.id));
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

  const overview =
    view === "overview"
      ? await (async () => {
          const activeIds = active.map((r) => r.id);
          const [[team], reportInput, loop] = await Promise.all([
            db().select({ n: count() }).from(jobTeam).where(eq(jobTeam.jobId, job.id)),
            loadReportInput(job.id, "all"),
            activeIds.length
              ? db().select().from(interviews).where(inArray(interviews.applicationId, activeIds))
              : Promise.resolve([]),
          ]);
          const assigned = loop.length
            ? await db()
                .select({ interviewId: interviewInterviewers.interviewId, id: users.id, name: users.name })
                .from(interviewInterviewers)
                .innerJoin(users, eq(users.id, interviewInterviewers.userId))
                .where(inArray(interviewInterviewers.interviewId, loop.map((i) => i.id)))
            : [];
          // Interviews whose feedback is overdue, and who still owes it.
          const overdueInterviews = loop.flatMap((i) => {
            const people = assigned.filter((a) => a.interviewId === i.id);
            const state = {
              scheduledAt: i.scheduledAt,
              completedAt: i.completedAt,
              cancelledAt: i.cancelledAt,
              interviewerIds: people.map((p) => p.id),
              submittedBy: feedback.filter((f) => f.interviewId === i.id).map((f) => f.authorId),
            };
            if (!isOverdue(state)) return [];
            const app = active.find((a) => a.id === i.applicationId)!;
            const missing = missingFeedback(state).map((id) => people.find((p) => p.id === id)?.name ?? "someone");
            return [{ candidateId: app.candidateId, name: app.name, interview: i.name, missing }];
          });
          const appsWithInterviews = active
            .filter((a) => loop.some((i) => i.applicationId === a.id && !i.cancelledAt && i.stageId === a.stageId))
            .map((a) => a.id);
          return {
            health: jobHealth({
              jobStatus: job.status,
              apps: rows,
              stages,
              scorecards: feedback,
              teamSize: team.n,
              overdueInterviews,
              appsWithInterviews,
            }),
            weeks: weeklyApplicants(rows),
            tables: reportTables(reportInput),
          };
        })()
      : null;
  const advanced = rows.filter((r) => r.status === "hired" || (r.stageId && r.stageId !== stages[0]?.id)).length;

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
            <Link href={`/jobs/${job.id}/interview-plan`} className="btn btn-secondary">
              Interview plan
            </Link>
            <Link href={`/jobs/${job.id}/edit`} className="btn btn-secondary">
              Edit job
            </Link>
          </div>
        )}
      </div>

      <nav aria-label="View" className="mt-6 flex flex-wrap items-center gap-4 text-sm">
        <Link href={`/jobs/${job.id}`} aria-current={view === "overview" ? "page" : undefined} className={view === "overview" ? "font-semibold" : "link"}>
          Overview
        </Link>
        <Link href={`/jobs/${job.id}?view=board`} aria-current={view === "board" ? "page" : undefined} className={view === "board" ? "font-semibold" : "link"}>
          Pipeline
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

      {overview ? (
        <div className="mt-4 space-y-6">
          <section aria-label="At a glance" className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Days open", value: daysSince(job.createdAt) },
              { label: "Applicants", value: rows.length },
              { label: "Active", value: active.length },
              { label: "Past first stage", value: advanced },
              { label: "Hired", value: rows.filter((r) => r.status === "hired").length },
              { label: "Rejected", value: rows.filter((r) => r.status === "rejected").length },
            ].map((stat) => (
              <div key={stat.label} className="card">
                <div className="muted text-xs">{stat.label}</div>
                <div className="mt-1 text-2xl font-semibold">{stat.value}</div>
              </div>
            ))}
          </section>

          <section className="card" aria-labelledby="health-title">
            <div className="card-header">
              <h2 id="health-title" className="card-title">Pipeline health</h2>
              <p className="card-note">Things that need attention on this job.</p>
            </div>
            {overview.health.length === 0 ? (
              <p className="text-sm">Everything looks healthy. No stuck candidates, missing feedback, or bottlenecks.</p>
            ) : (
              <ul className="card-rows text-sm">
                {overview.health.map((check) => (
                  <li key={check.id + check.title} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ background: check.level === "warn" ? "#d97706" : "var(--muted)" }}
                    />
                    <div className="min-w-0">
                      <p className="font-medium">
                        <span className="sr-only">{check.level === "warn" ? "Needs attention: " : "Note: "}</span>
                        {check.title}
                      </p>
                      <p className="muted">{check.detail}</p>
                      {check.candidates.length > 0 && (
                        <p className="mt-1">
                          {check.candidates.slice(0, 6).map((c, i) => (
                            <span key={c.id}>
                              {i > 0 && ", "}
                              <Link href={`/candidates/${c.id}`} className="link">
                                {c.name}
                              </Link>
                            </span>
                          ))}
                          {check.candidates.length > 6 && <span className="muted"> and {check.candidates.length - 6} more</span>}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card" aria-labelledby="funnel-title">
              <div className="card-header">
                <h2 id="funnel-title" className="card-title">Funnel</h2>
                <p className="card-note">Applicants who reached each stage or a later one, all time.</p>
              </div>
              {rows.length === 0 ? (
                <p className="muted text-sm">No applicants yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(overview.tables.funnel?.rows ?? []).map(([label, n, percent]) => (
                    <li key={String(label)} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3">
                      <span className="truncate">{label}</span>
                      <span className="h-2 overflow-hidden rounded" style={{ background: "var(--bg)" }}>
                        <span
                          className="block h-full rounded"
                          style={{ width: `${Number(percent)}%`, background: "var(--accent)" }}
                        />
                      </span>
                      <span className="text-right tabular-nums">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="weeks-title">
              <div className="card-header">
                <h2 id="weeks-title" className="card-title">Applicants per week</h2>
                <p className="card-note">Last 8 weeks.</p>
              </div>
              <div className="flex h-32 items-end gap-2" role="img" aria-label={`Applicants per week: ${overview.weeks.map((w) => w.count).join(", ")}`}>
                {overview.weeks.map((w) => {
                  const max = Math.max(1, ...overview.weeks.map((x) => x.count));
                  return (
                    <div key={w.start.toISOString()} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-xs tabular-nums">{w.count || ""}</span>
                      <span
                        className="w-full rounded-t"
                        style={{ height: `${(w.count / max) * 85}%`, minHeight: 2, background: "var(--accent)" }} /* leaves room for the count label */
                      />
                    </div>
                  );
                })}
              </div>
              <p className="muted mt-2 flex justify-between text-xs">
                <span>{overview.weeks[0].start.toLocaleDateString()}</span>
                <span>This week</span>
              </p>
            </section>
          </div>

          <section className="card" aria-labelledby="sources-title">
            <div className="card-header">
              <h2 id="sources-title" className="card-title">Sources</h2>
              <p className="card-note">Where applicants came from. Advanced means they moved past their first stage.</p>
            </div>
            {(overview.tables.sources?.rows.length ?? 0) === 0 ? (
              <p className="muted text-sm">No applicants yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    {overview.tables.sources!.head.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {overview.tables.sources!.rows.map((cells) => (
                    <tr key={String(cells[0])}>
                      {cells.map((cell, i) => (
                        <td key={i}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : view === "board" ? (
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
