import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { activity, applications, candidates, jobs, notes, scorecards, stages, users } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeCandidate, visibleJobIds } from "@/lib/hiring";
import { canManageHiring } from "@/lib/permissions";
import { isUuid } from "@/lib/validation";
import type { Recommendation } from "@/lib/scorecards";
import { addNoteAction, moveStageAction, setStatusAction } from "../actions";
import { Scorecards, type ScorecardRow } from "./scorecards";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!isUuid(id) || !(await canSeeCandidate(user, id))) notFound();
  const manage = canManageHiring(user.role);

  const [candidate] = await db().select().from(candidates).where(eq(candidates.id, id));
  if (!candidate) notFound();

  // Interviewers only see this candidate's applications on their own jobs.
  const ids = await visibleJobIds(user);
  const apps = await db()
    .select({
      id: applications.id,
      jobId: applications.jobId,
      stageId: applications.stageId,
      status: applications.status,
      rejectionReason: applications.rejectionReason,
      appliedAt: applications.appliedAt,
      jobTitle: jobs.title,
      attributes: jobs.scorecardAttributes,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.candidateId, id), ids ? inArray(applications.jobId, ids) : undefined))
    .orderBy(desc(applications.appliedAt));

  const appIds = apps.map((a) => a.id);
  const [jobStages, events, candidateNotes, cards] = await Promise.all([
    apps.length
      ? db()
          .select()
          .from(stages)
          .where(inArray(stages.jobId, apps.map((a) => a.jobId)))
          .orderBy(asc(stages.position))
      : [],
    appIds.length
      ? db()
          .select({
            id: activity.id,
            type: activity.type,
            data: activity.data,
            createdAt: activity.createdAt,
            applicationId: activity.applicationId,
            actor: users.name,
          })
          .from(activity)
          .leftJoin(users, eq(users.id, activity.actorId))
          .where(inArray(activity.applicationId, appIds))
      : [],
    db()
      .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, author: users.name })
      .from(notes)
      .innerJoin(users, eq(users.id, notes.authorId))
      .where(eq(notes.candidateId, id)),
    appIds.length
      ? db()
          .select({
            id: scorecards.id,
            applicationId: scorecards.applicationId,
            authorId: scorecards.authorId,
            author: users.name,
            stageName: scorecards.stageName,
            recommendation: scorecards.recommendation,
            ratings: scorecards.ratings,
            summary: scorecards.summary,
            updatedAt: scorecards.updatedAt,
          })
          .from(scorecards)
          .innerJoin(users, eq(users.id, scorecards.authorId))
          .where(inArray(scorecards.applicationId, appIds))
          .orderBy(desc(scorecards.updatedAt))
      : [],
  ]);
  const cardsFor = (applicationId: string): ScorecardRow[] =>
    cards
      .filter((c) => c.applicationId === applicationId)
      .map((c) => ({ ...c, recommendation: c.recommendation as Recommendation }));

  const stageName = new Map(jobStages.map((s) => [s.id, s.name]));
  const jobTitleByApp = new Map(apps.map((a) => [a.id, a.jobTitle]));

  const timeline = [
    ...events.map((e) => ({
      key: `a-${e.id}`,
      at: e.createdAt,
      who: e.actor,
      text: describe(e.type, e.data, stageName),
      job: e.applicationId ? jobTitleByApp.get(e.applicationId) : undefined,
      body: null as string | null,
    })),
    ...candidateNotes.map((n) => ({
      key: `n-${n.id}`,
      at: n.createdAt,
      who: n.author,
      text: "added a note",
      job: undefined,
      body: n.body,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{candidate.fullName}</h1>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        {(
          [
            ["Email", candidate.email && <a href={`mailto:${candidate.email}`} className="link">{candidate.email}</a>],
            ["Phone", candidate.phone],
            ["Location", candidate.location],
            [
              "LinkedIn",
              candidate.linkedinUrl && (
                <a href={candidate.linkedinUrl} className="link" rel="noopener noreferrer" target="_blank">
                  Profile
                </a>
              ),
            ],
            ["Source", candidate.source],
            [
              "Resume",
              candidate.resumeKey && (
                <a href={`/api/resumes/${candidate.id}`} className="link">
                  {candidate.resumeName ?? "Download"}
                </a>
              ),
            ],
          ] as const
        )
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>

      <h2 className="mt-8 text-lg font-semibold">Applications</h2>
      <div className="mt-3 space-y-3">
        {apps.map((app) => {
          const options = jobStages.filter((s) => s.jobId === app.jobId);
          return (
            <div key={app.id} className="card space-y-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/jobs/${app.jobId}`} className="link font-medium">
                  {app.jobTitle}
                </Link>
                <span className="muted">
                  <span className="capitalize">{app.status}</span> · applied {app.appliedAt.toLocaleDateString()}
                </span>
              </div>
              {app.status === "rejected" && app.rejectionReason && (
                <p className="muted">Reason: {app.rejectionReason}</p>
              )}
              {manage && app.status === "active" ? (
                <div className="flex flex-wrap items-end gap-4">
                  <form action={moveStageAction.bind(null, app.id)} className="flex items-end gap-2">
                    <div>
                      <label className="label" htmlFor={`stage-${app.id}`}>
                        Stage
                      </label>
                      <select
                        // Re-mount when the stage changes; React resets forms after an action,
                        // which would otherwise snap back to the stale default.
                        key={app.stageId}
                        id={`stage-${app.id}`}
                        name="stageId"
                        defaultValue={app.stageId ?? undefined}
                        className="input"
                      >
                        {options.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className="btn btn-secondary">
                      Move
                    </button>
                  </form>
                  <form action={setStatusAction.bind(null, app.id, "rejected")} className="flex items-end gap-2">
                    <div>
                      <label className="label" htmlFor={`reason-${app.id}`}>
                        Rejection reason
                      </label>
                      <input id={`reason-${app.id}`} name="reason" className="input" placeholder="Optional" />
                    </div>
                    <button type="submit" className="btn btn-secondary">
                      Reject
                    </button>
                  </form>
                  <form action={setStatusAction.bind(null, app.id, "withdrawn")}>
                    <button type="submit" className="btn btn-secondary">
                      Mark withdrawn
                    </button>
                  </form>
                  <form action={setStatusAction.bind(null, app.id, "hired")}>
                    <button type="submit" className="btn btn-secondary">
                      Mark hired
                    </button>
                  </form>
                </div>
              ) : (
                <div>
                  Stage: {app.stageId ? stageName.get(app.stageId) : "-"}
                  {manage && app.status !== "active" && (
                    <form action={setStatusAction.bind(null, app.id, "active")} className="ml-3 inline">
                      <button type="submit" className="link">
                        Reopen
                      </button>
                    </form>
                  )}
                </div>
              )}
              <Scorecards
                applicationId={app.id}
                rows={cardsFor(app.id)}
                attributes={app.attributes}
                userId={user.id}
                managesHiring={manage}
              />
            </div>
          );
        })}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Notes and activity</h2>
      <form action={addNoteAction.bind(null, candidate.id)} className="mt-3 space-y-2">
        <label className="label" htmlFor="note">
          Add a note
        </label>
        <textarea id="note" name="body" rows={3} required className="input" />
        <button type="submit" className="btn">
          Save note
        </button>
      </form>
      <ol className="mt-6 space-y-4 text-sm">
        {timeline.map((item) => (
          <li key={item.key}>
            <div>
              <span className="font-medium">{item.who ?? "Candidate"}</span> {item.text}
              {item.job && <span className="muted"> · {item.job}</span>}
            </div>
            <div className="muted text-xs">{item.at.toLocaleString()}</div>
            {item.body && <p className="mt-1 whitespace-pre-wrap">{item.body}</p>}
          </li>
        ))}
      </ol>
    </>
  );
}

function describe(type: string, data: Record<string, unknown>, stageName: Map<string, string>): string {
  const name = (id: unknown) => (typeof id === "string" ? stageName.get(id) : undefined) ?? "a removed stage";
  switch (type) {
    case "applied":
      return "applied";
    case "added":
      return "added this candidate";
    case "stage_changed":
      return `moved them from ${name(data.from)} to ${name(data.to)}`;
    case "rejected":
      return data.reason ? `rejected them: ${String(data.reason)}` : "rejected them";
    case "withdrawn":
      return "marked them as withdrawn";
    case "reopened":
      return "reopened the application";
    case "hired":
      return "marked them as hired";
    case "scorecard_submitted":
      return `submitted a scorecard${typeof data.stage === "string" ? ` for ${data.stage}` : ""}`;
    default:
      return type;
  }
}
