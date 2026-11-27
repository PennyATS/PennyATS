import Link from "next/link";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { withScorecardFacts } from "@/lib/db-context";
import { activity, applicationNotes, applications, candidates, interviewInterviewers, interviews, jobTeam, scorecards, users } from "@pennyats/db";
import { requireJobAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { daysSince, jobHealth, weeklyApplicants } from "@/lib/job-health";
import { isOverdue, missingFeedback } from "@/lib/interviews";
import { can } from "@/lib/permissions";
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
  const view = requested === "board" || requested === "list" || requested === "archived" ? requested : "overview";
  // The pipeline lists candidates, so it needs more than seeing the job (Executive sees summaries only).
  const user = await requireJobAccess("applications.view", id);
  const manage = can(user, "applications.move", { jobId: id });
  // Recommendation breakdowns need scorecards.view_all; phone screen notes need their own read (#97).
  const seeCards = can(user, "scorecards.view_all", { jobId: id });
  const seeScreens = can(user, "notes.phone_screen.read", { jobId: id });
  const { job, stages } = await loadJob(user, id);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  const rows = await db()
    .select({
      id: applications.id,
      status: applications.status,
      stageId: applications.stageId,
      appliedAt: applications.appliedAt,
      stageChangedAt: applications.stageChangedAt,
      rejectionReason: applications.rejectionReason,
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
  const archived = rows.filter((r) => r.status === "rejected" || r.status === "withdrawn");
  // Archived view: when each was archived, and whether phone screen notes were kept.
  const archiveDetails =
    view === "archived" && archived.length
      ? await Promise.all([
          db()
            .select({ applicationId: activity.applicationId, at: activity.createdAt })
            .from(activity)
            .where(and(inArray(activity.applicationId, archived.map((r) => r.id)), inArray(activity.type, ["rejected", "withdrawn"])))
            .orderBy(desc(activity.createdAt)),
          seeScreens
            ? db()
                .select({ applicationId: applicationNotes.applicationId })
                .from(applicationNotes)
                .where(inArray(applicationNotes.applicationId, archived.map((r) => r.id)))
            : Promise.resolve([] as { applicationId: string }[]),
        ])
      : null;

  // Scorecards on this job: board card summaries and the overview's feedback check.
  // Counts and who submitted, not content; content stays behind the blind rule (#119).
  const feedback = await withScorecardFacts(() =>
    db()
    .select({
      applicationId: scorecards.applicationId,
      recommendation: scorecards.recommendation,
      stageName: scorecards.stageName,
      interviewId: scorecards.interviewId,
      authorId: scorecards.authorId,
    })
    .from(scorecards)
    .innerJoin(applications, eq(applications.id, scorecards.applicationId))
    .where(eq(applications.jobId, job.id)),
  );
  function feedbackFor(applicationId: string): string | null {
    const recs = feedback.filter((f) => f.applicationId === applicationId).map((f) => f.recommendation as Recommendation);
    if (recs.length === 0) return null;
    // Interviewers only get a count here; the candidate page decides when they may see the rest.
    if (!seeCards) return `${recs.length} scorecard${recs.length === 1 ? "" : "s"}`;
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
            loadReportInput(job.id, "all", null),
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
      {view === "board" && (
        <ol aria-label="Pipeline stages" className="mb-4 flex flex-wrap gap-2">
          {stages.map((s, i) => {
            const n = active.filter((r) => r.stageId === s.id).length;
            return (
              <li key={s.id} className="flex shrink-0 items-center gap-2">
                {i > 0 && <span aria-hidden="true" className="muted">→</span>}
                <Link
                  href={`/candidates?${new URLSearchParams({ job: job.id, stage: s.name, status: "active" })}`}
                  className="stage-tab"
                  title={`Review ${s.name} candidates one by one`}
                >
                  <span className="block text-[13px] font-semibold">{s.name}</span>
                  <span className="muted block text-[11px]">{n} candidate{n === 1 ? "" : "s"}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex shrink-0 items-center gap-2 sm:ml-auto">
            <Link href={`/jobs/${job.id}?view=archived`} className="stage-tab">
              <span className="block text-[13px] font-semibold">Archived</span>
              <span className="muted block text-[11px]">{archived.length} candidate{archived.length === 1 ? "" : "s"}</span>
            </Link>
          </li>
        </ol>
      )}

      {overview ? (
        <div className="space-y-6">
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
        <div>
          {stages.length === 0 && active.length === 0 ? (
            <p className="muted text-sm">This job has no stages. Add some on the edit page.</p>
          ) : (
            <Board
              jobId={job.id}
              stages={stages.map((s) => ({ id: s.id, name: s.name }))}
              cards={boardCards}
              canMove={manage}
              moveAction={moveCardAction}
            />
          )}
        </div>
      ) : view === "archived" ? (
        <section className="card !p-0" aria-labelledby="archived-title">
          <div className="card-header px-5 pt-5">
            <h2 id="archived-title" className="card-title">Archived</h2>
            <p className="card-note">
              Rejected and withdrawn candidates. Their phone screen notes, scorecards, and history stay on their profile.
            </p>
          </div>
          {archived.length === 0 ? (
            <p className="muted px-5 pb-5 text-sm">Nobody archived on this job yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table !rounded-none !border-x-0 !border-b-0">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Archived from</th>
                    <th>Outcome</th>
                    <th>Reason</th>
                    <th>Phone screen</th>
                    <th>Archived</th>
                  </tr>
                </thead>
                <tbody>
                  {archived.map((r) => {
                    const at = archiveDetails?.[0].find((a) => a.applicationId === r.id)?.at ?? r.stageChangedAt;
                    return (
                      <tr key={r.id}>
                        <td>
                          <Link href={`/candidates/${r.candidateId}?job=${job.id}&status=${r.status}`} className="link">
                            {r.name}
                          </Link>
                          {r.email && <div className="muted text-xs">{r.email}</div>}
                        </td>
                        <td>{r.stageId ? stageName.get(r.stageId) : "-"}</td>
                        <td className="capitalize">{r.status}</td>
                        <td>{r.rejectionReason ?? <span className="muted">-</span>}</td>
                        <td>{archiveDetails?.[1].some((n) => n.applicationId === r.id) ? "Notes kept" : <span className="muted">-</span>}</td>
                        <td className="whitespace-nowrap">{at.toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : rows.length === 0 ? (
        <p className="card muted text-sm">No applications yet.</p>
      ) : (
        <table className="table">
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
                  <Link href={`/candidates/${r.candidateId}?job=${job.id}`} className="link">
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
