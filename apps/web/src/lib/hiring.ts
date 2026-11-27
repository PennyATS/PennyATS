import { and, asc, eq, inArray } from "drizzle-orm";
import {
  activity,
  applications,
  candidates,
  interviewInterviewers,
  interviewTemplateInterviewers,
  interviewTemplates,
  interviews,
  jobTeam,
  jobs,
  stages,
  type Db,
} from "@pennyats/db";
import { db } from "./db";
import type { SessionUser } from "./auth";
import { can, jobPermissionsFrom } from "./permissions";
import { isUuid, type CandidateInput } from "./validation";
import { jobWatchers, notify } from "./notifications";
import { queueWebhookEvent } from "./webhooks";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/**
 * Job ids the user may see, or null for "all jobs". People without `jobs.view_all` see the jobs
 * they are on the hiring team for. Confidential jobs (#96) are left out for everyone else unless
 * they have `jobs.view_confidential`, so lists, search, dashboards, and reports skip them.
 */
export async function visibleJobIds(user: Pick<SessionUser, "id" | "role" | "permissions">): Promise<string[] | null> {
  const team = (await db().select({ jobId: jobTeam.jobId }).from(jobTeam).where(eq(jobTeam.userId, user.id))).map((r) => r.jobId);
  if (!can(user, "jobs.view_all")) return team;
  if (can(user, "jobs.view_confidential")) return null;
  const confidential = await db().select({ id: jobs.id }).from(jobs).where(eq(jobs.confidential, true));
  const onTeam = new Set(team);
  if (confidential.every((j) => onTeam.has(j.id))) return null;
  const open = await db().select({ id: jobs.id }).from(jobs).where(eq(jobs.confidential, false));
  return [...open.map((j) => j.id), ...confidential.filter((j) => onTeam.has(j.id)).map((j) => j.id)];
}

/** Jobs the user is on the hiring team for, for the "My jobs" filters. */
export async function myJobIds(userId: string): Promise<string[]> {
  return (await db().select({ jobId: jobTeam.jobId }).from(jobTeam).where(eq(jobTeam.userId, userId))).map((r) => r.jobId);
}

/** Visible jobs, narrowed to the user's own when `mine` is set. */
export async function jobIdsFor(user: Pick<SessionUser, "id" | "role" | "permissions">, mine: boolean): Promise<string[] | null> {
  const visible = await visibleJobIds(user);
  if (!mine) return visible;
  const own = await myJobIds(user.id);
  return visible === null ? own : own.filter((id) => visible.includes(id));
}

/** Team roles by job, as `can()` reads them from `user.jobPermissions`. Loaded once per request. */
export async function loadJobPermissions(userId: string) {
  const rows = await db().select({ jobId: jobTeam.jobId, teamRole: jobTeam.teamRole }).from(jobTeam).where(eq(jobTeam.userId, userId));
  return jobPermissionsFrom(rows);
}

/**
 * Jobs whose reports the user may see, or null for all. Without `reports.view_all` that is only
 * jobs they are on the hiring team for (Recruiter and Hiring Manager presets: "own jobs").
 */
export async function reportJobIds(user: SessionUser): Promise<string[] | null> {
  if (can(user, "reports.view_all")) return visibleJobIds(user);
  const rows = await db().select({ jobId: jobTeam.jobId }).from(jobTeam).where(eq(jobTeam.userId, user.id));
  return rows.map((r) => r.jobId);
}

export async function canSeeJob(user: SessionUser, jobId: string): Promise<boolean> {
  const ids = await visibleJobIds(user);
  return ids === null || ids.includes(jobId);
}

export type ActivityType =
  | "applied"
  | "added"
  | "stage_changed"
  | "rejected"
  | "withdrawn"
  | "hired"
  | "reopened"
  | "scorecard_submitted"
  | "interview_added"
  | "interview_scheduled"
  | "interview_completed"
  | "interview_cancelled";

export async function logActivity(
  ex: Executor,
  entry: {
    applicationId: string;
    actorId: string | null;
    type: ActivityType;
    data?: Record<string, unknown>;
  },
) {
  await ex.insert(activity).values({ ...entry, data: entry.data ?? {} });
}

/**
 * Find the candidate by email (or create them), then put them in the job's first stage.
 * Used by the public apply form and by recruiters adding someone by hand.
 * Returns created: false when the candidate already applied to this job.
 */
export async function addApplication(
  ex: Executor,
  input: {
    jobId: string;
    candidate: CandidateInput & { source: string | null };
    resume?: { key: string; name: string };
    /** Set when the applicant agreed to the privacy notice. */
    consentedAt?: Date;
    actorId: string | null;
    /** Where it came from, kept in the application's history, e.g. { via: "api", key: "pats_1a2b…" }. */
    attribution?: Record<string, string>;
  },
): Promise<{ candidateId: string; applicationId: string | null; created: boolean }> {
  const { candidate, resume, consentedAt } = input;
  let candidateId: string;

  if (candidate.email) {
    // Insert-then-select keeps this safe when two submissions with one email race.
    await ex
      .insert(candidates)
      .values({ ...candidate, resumeKey: resume?.key, resumeName: resume?.name, consentedAt })
      .onConflictDoNothing({ target: candidates.email });
    const [existing] = await ex
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.email, candidate.email));
    candidateId = existing.id;
    // A returning candidate's newest resume and consent replace the old ones.
    if (resume || consentedAt) {
      await ex
        .update(candidates)
        .set({
          ...(resume ? { resumeKey: resume.key, resumeName: resume.name } : {}),
          ...(consentedAt ? { consentedAt } : {}),
        })
        .where(eq(candidates.id, candidateId));
    }
  } else {
    const [created] = await ex
      .insert(candidates)
      .values({ ...candidate, resumeKey: resume?.key, resumeName: resume?.name, consentedAt })
      .returning({ id: candidates.id });
    candidateId = created.id;
  }

  const started = await startApplication(ex, {
    candidateId,
    jobId: input.jobId,
    actorId: input.actorId,
    source: candidate.source,
    attribution: input.attribution,
  });
  return { candidateId, ...started };
}

/**
 * Put an existing candidate in a job's first stage: creates the stage's planned interviews,
 * logs it, notifies the hiring team, and queues the application.created webhook.
 * Returns created: false when they already have an application for this job.
 */
export async function startApplication(
  ex: Executor,
  input: { candidateId: string; jobId: string; actorId: string | null; source: string | null; attribution?: Record<string, string> },
): Promise<{ applicationId: string | null; created: boolean }> {
  const { candidateId } = input;
  const [firstStage] = await ex
    .select({ id: stages.id })
    .from(stages)
    .where(eq(stages.jobId, input.jobId))
    .orderBy(asc(stages.position))
    .limit(1);

  const [application] = await ex
    .insert(applications)
    .values({ candidateId, jobId: input.jobId, stageId: firstStage?.id ?? null })
    .onConflictDoNothing()
    .returning({ id: applications.id });

  if (!application) return { applicationId: null, created: false };

  if (firstStage) await createStageInterviews(ex, application.id, firstStage.id, input.actorId);
  await logActivity(ex, {
    applicationId: application.id,
    actorId: input.actorId,
    type: input.actorId ? "added" : "applied",
    data: { source: input.source, ...(input.attribution ?? {}) },
  });
  const watchers = await jobWatchers(ex, input.jobId);
  await notify(ex, input.actorId, watchers.map((userId) => ({ userId, kind: "application" as const, applicationId: application.id })));
  const [stage] = firstStage
    ? await ex.select({ name: stages.name }).from(stages).where(eq(stages.id, firstStage.id))
    : [];
  await queueWebhookEvent(ex, "application.created", {
    application_id: application.id,
    candidate_id: candidateId,
    job_id: input.jobId,
    stage_id: firstStage?.id ?? null,
    stage_name: stage?.name ?? null,
    source: input.source,
  }, candidateId);
  return { applicationId: application.id, created: true };
}

/** Applications the user may act on, with job access checked. */
export async function getApplicationFor(user: SessionUser, applicationId: string) {
  const [app] = await db()
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId));
  if (!app || !(await canSeeJob(user, app.jobId))) return null;
  return app;
}

export async function stageBelongsToJob(stageId: string, jobId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: stages.id })
    .from(stages)
    .where(and(eq(stages.id, stageId), eq(stages.jobId, jobId)));
  return Boolean(row);
}

/** Recruiters and admins see every candidate; interviewers only those on their jobs. */
export async function canSeeCandidate(user: SessionUser, candidateId: string): Promise<boolean> {
  const ids = await visibleJobIds(user);
  if (ids === null) {
    const [row] = await db()
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.id, candidateId));
    return Boolean(row);
  }
  if (ids.length === 0) return false;
  const [row] = await db()
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.candidateId, candidateId), inArray(applications.jobId, ids)))
    .limit(1);
  return Boolean(row);
}

/**
 * Move an active application to another stage of its job and log it.
 * Returns the application when it moved, or null when the move isn't allowed.
 * Callers check the user's role; this checks job access, status, and that the stage fits.
 */
export async function moveApplication(user: SessionUser, applicationId: string, stageId: string) {
  if (!isUuid(applicationId) || !isUuid(stageId)) return null;
  const app = await getApplicationFor(user, applicationId);
  if (!app || app.status !== "active" || app.stageId === stageId) return null;
  if (!(await stageBelongsToJob(stageId, app.jobId))) return null;

  await db().transaction(async (tx) => {
    await tx
      .update(applications)
      .set({ stageId, stageChangedAt: new Date() })
      .where(eq(applications.id, app.id));
    await createStageInterviews(tx, app.id, stageId, user.id);
    await logActivity(tx, {
      applicationId: app.id,
      actorId: user.id,
      type: "stage_changed",
      data: { from: app.stageId, to: stageId },
    });
    const [stage] = await tx.select({ name: stages.name }).from(stages).where(eq(stages.id, stageId));
    const watchers = await jobWatchers(tx, app.jobId);
    await notify(tx, user.id, watchers.map((userId) => ({ userId, kind: "stage_changed" as const, applicationId: app.id, data: { stage: stage?.name ?? "" } })));
    await queueWebhookEvent(tx, "application.stage_changed", {
      application_id: app.id,
      candidate_id: app.candidateId,
      job_id: app.jobId,
      from_stage_id: app.stageId,
      to_stage_id: stageId,
      to_stage_name: stage?.name ?? null,
    }, app.candidateId);
  });
  return app;
}

/** Stage label a scorecard is filed under: the application's current stage. */
export async function currentStageName(stageId: string | null): Promise<string> {
  if (!stageId) return "General";
  const [stage] = await db().select({ name: stages.name }).from(stages).where(eq(stages.id, stageId));
  return stage?.name ?? "General";
}

/**
 * Create a candidate's interviews for a stage from the job's interview plan, copying each
 * planned interview's details and default interviewers. Safe to call again: interviews
 * already created from a template are skipped. Returns how many were created.
 */
export async function createStageInterviews(
  ex: Executor,
  applicationId: string,
  stageId: string,
  /** Who triggered it, so they aren't notified about their own action. */
  actorId: string | null = null,
): Promise<number> {
  const plan = await ex
    .select()
    .from(interviewTemplates)
    .innerJoin(stages, eq(stages.id, interviewTemplates.stageId))
    .where(eq(interviewTemplates.stageId, stageId))
    .orderBy(asc(interviewTemplates.position), asc(interviewTemplates.createdAt));
  if (plan.length === 0) return 0;

  const people = await ex
    .select()
    .from(interviewTemplateInterviewers)
    .where(inArray(interviewTemplateInterviewers.templateId, plan.map((p) => p.interview_templates.id)));

  let created = 0;
  for (const { interview_templates: t, stages: stage } of plan) {
    const [row] = await ex
      .insert(interviews)
      .values({
        applicationId,
        templateId: t.id,
        stageId,
        name: t.name,
        stageName: stage.name,
        durationMinutes: t.durationMinutes,
        attributes: t.attributes,
        instructions: t.instructions,
      })
      .onConflictDoNothing({ target: [interviews.applicationId, interviews.templateId] })
      .returning({ id: interviews.id });
    if (!row) continue;
    created += 1;
    const assigned = people.filter((p) => p.templateId === t.id);
    if (assigned.length) {
      await ex
        .insert(interviewInterviewers)
        .values(assigned.map((p) => ({ interviewId: row.id, userId: p.userId })))
        .onConflictDoNothing();
      await notify(ex, actorId, assigned.map((p) => ({ userId: p.userId, kind: "interview_assigned" as const, applicationId, interviewId: row.id })));
    }
  }
  return created;
}
