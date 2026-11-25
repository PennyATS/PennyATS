import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  activity,
  applications,
  candidates,
  candidateAvailabilityLinks,
  candidateAvailabilityWindows,
  emails,
  emailTemplateFolders,
  emailTemplates,
  interviewBookingLinks,
  interviewInterviewers,
  interviewTemplates,
  interviews,
  jobs,
  notes,
  scorecards,
  schedulingDeliveries,
  stages,
  users,
} from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeCandidate, visibleJobIds } from "@/lib/hiring";
import { ActionForm, SubmitButton } from "@/components/form";
import { canManageHiring, canManageUsers } from "@/lib/permissions";
import { isUuid } from "@/lib/validation";
import { smtpConfigured } from "@/lib/smtp";
import type { Recommendation } from "@/lib/scorecards";
import { isAiFeatureOn } from "@/lib/ai";
import {
  addNoteAction,
  deleteCandidateAction,
  moveStageAction,
  retrySchedulingDeliveryAction,
  resendEmailAction,
  sendCandidateEmailAction,
  setStatusAction,
  summarizeFeedbackAction,
} from "../actions";
import { Scorecards, type ScorecardRow } from "./scorecards";
import { Interviews, type InterviewRow } from "./interviews";
import { interviewStatus, isOverdue } from "@/lib/interviews";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!isUuid(id) || !(await canSeeCandidate(user, id))) notFound();
  const manage = canManageHiring(user.role);
  // Summaries cover every scorecard, so only people who may see them all get the button.
  const aiSummaries = manage && (await isAiFeatureOn("feedbackSummaries"));

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
            interviewId: scorecards.interviewId,
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
  const [templates, sentEmails] = await Promise.all([
    manage ? db().select({ id: emailTemplates.id, name: emailTemplates.name, folder: emailTemplateFolders.name })
      .from(emailTemplates).leftJoin(emailTemplateFolders, eq(emailTemplateFolders.id, emailTemplates.folderId))
      .orderBy(asc(emailTemplateFolders.name), asc(emailTemplates.name)) : [],
    db().select({ id: emails.id, subject: emails.subject, body: emails.body, bodyHtml: emails.bodyHtml,
      status: emails.status, error: emails.error, stageId: emails.stageId, applicationId: emails.applicationId,
      sentAt: emails.sentAt, sender: users.name }).from(emails)
      .leftJoin(users, eq(users.id, emails.sentBy)).where(eq(emails.candidateId, id)),
  ]);
  const templateGroups = Map.groupBy(templates, (t) => t.folder ?? "Unfiled");
  // Interview loop: interviews, who runs them, and who has submitted feedback for each.
  const [loop, planned, people] = await Promise.all([
    appIds.length
      ? db().select().from(interviews).where(inArray(interviews.applicationId, appIds)).orderBy(asc(interviews.createdAt))
      : [],
    apps.some((a) => a.stageId)
      ? db()
          .select({ id: interviewTemplates.id, stageId: interviewTemplates.stageId })
          .from(interviewTemplates)
          .where(inArray(interviewTemplates.stageId, apps.flatMap((a) => (a.stageId ? [a.stageId] : []))))
      : [],
    manage
      ? db().select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name))
      : [],
  ]);
  const loopPeople = loop.length
    ? await db()
        .select({ interviewId: interviewInterviewers.interviewId, id: users.id, name: users.name })
        .from(interviewInterviewers)
        .innerJoin(users, eq(users.id, interviewInterviewers.userId))
        .where(inArray(interviewInterviewers.interviewId, loop.map((i) => i.id)))
    : [];
  const bookingLinks = loop.length ? await db().select({ interviewId: interviewBookingLinks.interviewId,
    expiresAt: interviewBookingLinks.expiresAt, revokedAt: interviewBookingLinks.revokedAt })
    .from(interviewBookingLinks).where(inArray(interviewBookingLinks.interviewId, loop.map((i) => i.id))) : [];
  const [availabilityLinks, availabilityWindows] = await Promise.all([
    appIds.length ? db().select().from(candidateAvailabilityLinks)
      .where(inArray(candidateAvailabilityLinks.applicationId, appIds)) : [],
    appIds.length ? db().select().from(candidateAvailabilityWindows)
      .where(inArray(candidateAvailabilityWindows.applicationId, appIds))
      .orderBy(asc(candidateAvailabilityWindows.startsAt)) : [],
  ]);
  const deliveries = manage && appIds.length ? await db().select({ id: schedulingDeliveries.id,
    applicationId: schedulingDeliveries.applicationId, kind: schedulingDeliveries.kind,
    recipientEmail: schedulingDeliveries.recipientEmail, status: schedulingDeliveries.status,
    lastError: schedulingDeliveries.lastError, scheduledFor: schedulingDeliveries.scheduledFor,
    sentAt: schedulingDeliveries.sentAt })
    .from(schedulingDeliveries).where(inArray(schedulingDeliveries.applicationId, appIds))
    .orderBy(desc(schedulingDeliveries.updatedAt)) : [];
  const submittedFor = (interviewId: string) =>
    cards.filter((c) => c.interviewId === interviewId).map((c) => c.authorId);
  const interviewsFor = (applicationId: string): InterviewRow[] =>
    loop
      .filter((i) => i.applicationId === applicationId)
      .map((i) => {
        const assigned = loopPeople.filter((p) => p.interviewId === i.id);
        const state = {
          scheduledAt: i.scheduledAt,
          completedAt: i.completedAt,
          cancelledAt: i.cancelledAt,
          interviewerIds: assigned.map((p) => p.id),
          submittedBy: submittedFor(i.id),
        };
        return {
          id: i.id,
          name: i.name,
          stageName: i.stageName,
          durationMinutes: i.durationMinutes,
          scheduledAt: i.scheduledAt,
          scheduledTimeZone: i.scheduledTimeZone,
          meetingLocation: i.meetingLocation,
          googleEventId: i.googleEventId,
          googleSyncError: i.googleSyncError,
          googleRsvps: i.googleRsvps,
          googleLastSyncedAt: i.googleLastSyncedAt,
          bookingLinkActive: bookingLinks.some((link) => link.interviewId === i.id && !link.revokedAt && link.expiresAt > new Date()),
          cancelledAt: i.cancelledAt,
          status: interviewStatus(state),
          overdue: isOverdue(state),
          interviewers: assigned.map((p) => ({ id: p.id, name: p.name, submitted: state.submittedBy.includes(p.id) })),
        };
      });
  // The plan has interviews for this application's current stage that it doesn't have yet.
  const planAvailableFor = (app: { id: string; stageId: string | null }) => {
    const have = new Set(loop.filter((i) => i.applicationId === app.id).map((i) => i.templateId));
    return planned.some((t) => t.stageId === app.stageId && !have.has(t.id));
  };

  const cardsFor = (applicationId: string): ScorecardRow[] =>
    cards
      .filter((c) => c.applicationId === applicationId)
      .map((c) => ({
        ...c,
        recommendation: c.recommendation as Recommendation,
        interviewName: c.interviewId ? loop.find((i) => i.id === c.interviewId)?.name : null,
      }));

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
      email: null as { id: string; html: string | null; status: string; error: string | null } | null,
    })),
    ...candidateNotes.map((n) => ({
      key: `n-${n.id}`,
      at: n.createdAt,
      who: n.author,
      text: "added a note",
      job: undefined,
      body: n.body,
      email: null,
    })),
    ...sentEmails.map((message) => {
      const auto = message.stageId ? ` automatically on entering ${stageName.get(message.stageId) ?? "a stage"}` : "";
      const verb = message.status === "sent" ? "emailed candidate" : message.status === "sending" ? "is emailing candidate"
        : "email not sent";
      return { key: `email-${message.id}`, at: message.sentAt, who: message.sender,
        text: `${verb}${auto}: ${message.subject}`,
        job: message.applicationId ? jobTitleByApp.get(message.applicationId) : undefined,
        body: message.bodyHtml ? null : message.body,
        email: { id: message.id, html: message.bodyHtml, status: message.status, error: message.error } };
    }),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{candidate.fullName}</h1>
      <dl className="card mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
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
              <Interviews
                candidateId={candidate.id}
                applicationId={app.id}
                availabilityLinkActive={availabilityLinks.some((link) => link.applicationId === app.id &&
                  link.stageId === app.stageId && !link.revokedAt && link.expiresAt > new Date())}
                availability={availabilityWindows.filter((window) => window.applicationId === app.id && window.stageId === app.stageId)}
                rows={interviewsFor(app.id)}
                userId={user.id}
                manage={manage}
                people={people}
                planAvailable={planAvailableFor(app)}
                active={app.status === "active"}
              />
              {manage && deliveries.some((delivery) => delivery.applicationId === app.id) &&
                <section className="inset text-xs" aria-label="Scheduling messages">
                  <h3 className="font-medium">Scheduling messages</h3>
                  <ul className="mt-2 space-y-1">
                    {deliveries.filter((delivery) => delivery.applicationId === app.id).slice(0, 8).map((delivery) =>
                      <li key={delivery.id}>
                        {delivery.kind === "reminder" ? "Reminder" : delivery.kind === "stage_booking" ? "Booking link" : "Availability link"}
                        {" · "}{delivery.recipientEmail}{" · "}{delivery.status}
                        {delivery.status === "queued" && ` for ${delivery.scheduledFor.toLocaleString()}`}
                        {delivery.sentAt && ` ${delivery.sentAt.toLocaleString()}`}
                        {delivery.lastError && <span className="muted"> · {delivery.lastError}</span>}
                        {delivery.status === "failed" && delivery.lastError?.startsWith("SMTP did not confirm") &&
                          <form action={retrySchedulingDeliveryAction.bind(null, delivery.id)} className="ml-2 inline">
                            <button type="submit" className="link">Retry after checking SMTP</button>
                          </form>}
                      </li>)}
                  </ul>
                </section>}
              <Scorecards
                applicationId={app.id}
                rows={cardsFor(app.id)}
                attributes={app.attributes}
                summarizeAction={aiSummaries ? summarizeFeedbackAction.bind(null, app.id) : undefined}
                userId={user.id}
                managesHiring={manage}
              />
            </div>
          );
        })}
      </div>

      {manage && candidate.email && <section className="card mt-8 text-sm" aria-labelledby="email-title">
        <h2 id="email-title" className="card-title">Email candidate</h2>
        {!smtpConfigured() ? <p className="muted mt-2">Configure SMTP under Admin → Email to send messages.</p> :
          templates.length === 0 ? <p className="muted mt-2"><Link href="/templates/new" className="link">Write an email template</Link> first.</p> :
          <ActionForm action={sendCandidateEmailAction.bind(null, candidate.id)} className="mt-4 space-y-3">
            <div><label className="label" htmlFor="email-application">Job</label>
              <select id="email-application" name="applicationId" className="input">
                {apps.map((app) => <option key={app.id} value={app.id}>{app.jobTitle}</option>)}
              </select></div>
            <div><label className="label" htmlFor="email-template">Template</label>
              <select id="email-template" name="templateId" className="input">
                {[...templateGroups].map(([folder, items]) => <optgroup key={folder} label={folder}>
                  {items.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </optgroup>)}
              </select></div>
            <SubmitButton variant="secondary">Send email</SubmitButton>
          </ActionForm>}
      </section>}

      <section className="card mt-8" aria-labelledby="notes-title">
      <div className="card-header">
        <h2 id="notes-title" className="card-title">Notes and activity</h2>
      </div>
      <form action={addNoteAction.bind(null, candidate.id)} className="space-y-2">
        <label className="label" htmlFor="note">
          Add a note
        </label>
        <textarea id="note" name="body" rows={3} required className="input" />
        <button type="submit" className="btn">
          Save note
        </button>
      </form>
      <ol className="card-rows mt-6 border-t pt-4 text-sm" style={{ borderColor: "var(--border)" }}>
        {timeline.map((item) => (
          <li key={item.key}>
            <div>
              <span className="font-medium">{item.who ?? "Candidate"}</span> {item.text}
              {item.job && <span className="muted"> · {item.job}</span>}
            </div>
            <div className="muted text-xs">{item.at.toLocaleString()}</div>
            {item.body && <p className="mt-1 whitespace-pre-wrap">{item.body}</p>}
            {item.email && (
              <>
                {(item.email.status === "failed" || item.email.status === "skipped") && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="error text-xs">{item.email.error ?? "Not sent."}</span>
                    {manage && smtpConfigured() && (
                      <form action={resendEmailAction.bind(null, item.email.id, candidate.id)}>
                        <button type="submit" className="link text-xs">Send now</button>
                      </form>
                    )}
                  </div>
                )}
                {item.email.html && (
                  <details className="mt-1">
                    <summary className="link cursor-pointer text-xs">Show email</summary>
                    {/* Sanitized when the template was saved; merge values were escaped. */}
                    <div className="rich-text inset mt-2" dangerouslySetInnerHTML={{ __html: item.email.html }} />
                  </details>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      </section>

      {manage && (
        <section className="card mt-8 text-sm" aria-labelledby="privacy-title">
          <h2 id="privacy-title" className="card-title">Privacy</h2>
          <p className="muted mt-1">
            {candidate.consentedAt
              ? `Agreed to the privacy notice on ${candidate.consentedAt.toLocaleDateString()}.`
              : "No privacy notice consent recorded."}
          </p>
          {canManageUsers(user.role) && (
            <>
              <p className="mt-3">
                <a href={`/api/candidates/${candidate.id}/export`} className="link">
                  Export all their data (JSON)
                </a>{" "}
                <span className="muted">for a data access request.</span>
              </p>
              <ActionForm action={deleteCandidateAction.bind(null, candidate.id)} className="inset mt-4 max-w-xl space-y-3">
                <h3 className="font-medium">Delete permanently</h3>
                <p className="muted">
                  Removes this candidate from every job, with their resume, scorecards, notes, and history. This
                  can&apos;t be undone. The audit log records that a deletion happened, not who it was.
                </p>
                <div>
                  <label className="label" htmlFor="reason">
                    Reason (optional, don&apos;t include their name)
                  </label>
                  <input id="reason" name="reason" className="input" placeholder="e.g. Deletion request received by email" />
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="confirm" required />
                  I understand this permanently deletes {candidate.fullName}&apos;s data.
                </label>
                <SubmitButton>Delete candidate</SubmitButton>
              </ActionForm>
            </>
          )}
        </section>
      )}
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
      return typeof data.interview === "string"
        ? `submitted a scorecard for ${data.interview}`
        : `submitted a scorecard${typeof data.stage === "string" ? ` for ${data.stage}` : ""}`;
    case "interview_added":
      return `added an interview: ${String(data.interview)}`;
    case "interview_scheduled":
      return data.at
        ? `${data.previousAt ? "rescheduled" : "scheduled"} ${String(data.interview)}${data.timeZone ? ` in ${String(data.timeZone)}` : ""}`
        : `cleared the time for ${String(data.interview)}`;
    case "interview_completed":
      return `marked ${String(data.interview)} as held`;
    case "interview_cancelled":
      return `cancelled ${String(data.interview)}`;
    default:
      return type;
  }
}
