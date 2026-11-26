/**
 * Hiring operations shared by the UI's server actions and the public API, so both run the
 * same rules and side effects (activity log, notifications, stage emails, webhooks).
 * Callers check the role and, for the API, the key's scopes; these check job access.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { applications, candidates, interviewInterviewers, interviews, jobTeam, notes, scorecards, users } from "@pennyats/db";
import type { SessionUser } from "./auth";
import { sendStageEntryEmail } from "./candidate-email";
import { mergeTags, normalizeTag } from "./candidate-review";
import { db } from "./db";
import { canSeeCandidate, currentStageName, getApplicationFor, logActivity, moveApplication } from "./hiring";
import { notify } from "./notifications";
import { queueStageLinkOnEntry, suppressQueuedStageLinks } from "./scheduling-delivery";
import type { loadScorecardContext } from "./scorecard-context";
import type { ScorecardInput } from "./scorecards";
import { deliverDueWebhooks, queueWebhookEvent } from "./webhooks";

export type ApplicationStatus = "active" | "hired" | "rejected" | "withdrawn";

/** Move an application to another stage of its job, with every side effect. Null when not allowed. */
export async function moveStage(user: SessionUser, applicationId: string, stageId: string) {
  const moved = await moveApplication(user, applicationId, stageId);
  if (!moved) return null;
  if (moved.stageId) await suppressQueuedStageLinks(applicationId, moved.stageId);
  await queueStageLinkOnEntry(applicationId, stageId);
  await sendStageEntryEmail(applicationId, stageId, user.id);
  void deliverDueWebhooks();
  return moved;
}

/**
 * Hire, reject, withdraw, or reopen. `reason` is the stored text (see rejectionReasonText);
 * a rejection needs one. Returns the application, or null when it isn't visible or unchanged.
 */
export async function setApplicationStatus(
  user: SessionUser,
  applicationId: string,
  status: ApplicationStatus,
  reason: string | null,
) {
  const app = await getApplicationFor(user, applicationId);
  if (!app || app.status === status) return null;
  if (status === "rejected" && !reason) return null;
  const stored = status === "active" ? null : reason;

  await db().transaction(async (tx) => {
    await tx
      .update(applications)
      .set({ status, rejectionReason: status === "rejected" ? stored : null })
      .where(eq(applications.id, app.id));
    await logActivity(tx, {
      applicationId: app.id,
      actorId: user.id,
      type: status === "active" ? "reopened" : status,
      data: stored ? { reason: stored } : {},
    });
  });
  return { ...app, status, rejectionReason: status === "rejected" ? stored : null };
}

/** Add normalized tags. Returns the new list, or null when the candidate doesn't exist. */
export async function addTags(candidateId: string, added: readonly string[]): Promise<string[] | null> {
  const [row] = await db().select({ tags: candidates.tags }).from(candidates).where(eq(candidates.id, candidateId));
  if (!row) return null;
  const tags = mergeTags(row.tags, added);
  await db().update(candidates).set({ tags }).where(eq(candidates.id, candidateId));
  return tags;
}

export async function removeTag(candidateId: string, tag: string): Promise<string[] | null> {
  const normalized = normalizeTag(tag);
  const [row] = await db().select({ tags: candidates.tags }).from(candidates).where(eq(candidates.id, candidateId));
  if (!row) return null;
  const tags = normalized ? row.tags.filter((t) => normalizeTag(t) !== normalized) : row.tags;
  await db().update(candidates).set({ tags }).where(eq(candidates.id, candidateId));
  return tags;
}

/** Anyone who can see the candidate may add a note. Returns the note, or null. */
export async function addNote(user: SessionUser, candidateId: string, body: string) {
  if (!(await canSeeCandidate(user, candidateId))) return null;
  const [note] = await db().insert(notes).values({ candidateId, authorId: user.id, body }).returning();
  return note;
}

type ScorecardContext = NonNullable<Awaited<ReturnType<typeof loadScorecardContext>>>;

/**
 * Save the user's scorecard for an interview, or for the stage when there is no interview.
 * Submitting again edits it. Returns the scorecard id.
 */
export async function submitScorecard(user: SessionUser, ctx: ScorecardContext, value: ScorecardInput): Promise<string> {
  const { app, stageName, interview } = ctx;
  const id = await db().transaction(async (tx) => {
    const insert = tx
      .insert(scorecards)
      .values({ applicationId: app.id, authorId: user.id, stageName, interviewId: interview?.id ?? null, ...value });
    const set = { ...value, updatedAt: new Date() };
    const [row] = interview
      ? await insert
          .onConflictDoUpdate({
            target: [scorecards.interviewId, scorecards.authorId],
            targetWhere: sql`interview_id is not null`,
            set,
          })
          .returning({ id: scorecards.id })
      : await insert
          .onConflictDoUpdate({
            target: [scorecards.applicationId, scorecards.authorId, scorecards.stageName],
            targetWhere: sql`interview_id is null`,
            set,
          })
          .returning({ id: scorecards.id });
    await logActivity(tx, {
      applicationId: app.id,
      actorId: user.id,
      type: "scorecard_submitted",
      data: interview ? { stage: stageName, interview: interview.name } : { stage: stageName },
    });
    await queueWebhookEvent(tx, "scorecard.submitted", {
      scorecard_id: row.id,
      application_id: app.id,
      candidate_id: app.candidateId,
      job_id: app.jobId,
      interview_id: interview?.id ?? null,
      stage_name: stageName,
      author_id: user.id,
    }, app.candidateId);
    return row.id;
  });
  void deliverDueWebhooks();
  return id;
}

/** Keep the active users among `ids` and add them to the job's hiring team so they can see it. */
export async function activeInterviewers(jobId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db()
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...new Set(ids)]), eq(users.active, true)));
  const valid = rows.map((r) => r.id);
  if (valid.length) {
    await db()
      .insert(jobTeam)
      .values(valid.map((userId) => ({ jobId, userId })))
      .onConflictDoNothing();
  }
  return valid;
}

/** A one-off interview that isn't in the job's plan. Returns its id. */
export async function addInterview(
  user: SessionUser,
  app: { id: string; jobId: string; stageId: string | null },
  input: { name: string; durationMinutes: number; interviewerIds: readonly string[] },
): Promise<string> {
  const ids = await activeInterviewers(app.jobId, input.interviewerIds);
  const stageName = await currentStageName(app.stageId);
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(interviews)
      .values({ applicationId: app.id, stageId: app.stageId, name: input.name, stageName, durationMinutes: input.durationMinutes })
      .returning({ id: interviews.id });
    if (ids.length) {
      await tx.insert(interviewInterviewers).values(ids.map((userId) => ({ interviewId: row.id, userId })));
      await notify(tx, user.id, ids.map((userId) => ({ userId, kind: "interview_assigned" as const, applicationId: app.id, interviewId: row.id })));
    }
    await logActivity(tx, { applicationId: app.id, actorId: user.id, type: "interview_added", data: { interview: input.name } });
    return row.id;
  });
}
