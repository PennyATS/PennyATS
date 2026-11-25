import { and, asc, eq, inArray } from "drizzle-orm";
import { activity, applications, candidates, jobTeam, stages, type Db } from "@pennyats/db";
import { db } from "./db";
import type { SessionUser } from "./auth";
import { seesAllJobs } from "./permissions";
import { isUuid, type CandidateInput } from "./validation";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

/** Job ids the user may see, or null for "all jobs". */
export async function visibleJobIds(user: SessionUser): Promise<string[] | null> {
  if (seesAllJobs(user.role)) return null;
  const rows = await db()
    .select({ jobId: jobTeam.jobId })
    .from(jobTeam)
    .where(eq(jobTeam.userId, user.id));
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
  | "scorecard_submitted";

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
    actorId: string | null;
  },
): Promise<{ candidateId: string; applicationId: string | null; created: boolean }> {
  const { candidate, resume } = input;
  let candidateId: string;

  if (candidate.email) {
    // Insert-then-select keeps this safe when two submissions with one email race.
    await ex
      .insert(candidates)
      .values({ ...candidate, resumeKey: resume?.key, resumeName: resume?.name })
      .onConflictDoNothing({ target: candidates.email });
    const [existing] = await ex
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.email, candidate.email));
    candidateId = existing.id;
    // A returning candidate's newest resume replaces the old one.
    if (resume) {
      await ex
        .update(candidates)
        .set({ resumeKey: resume.key, resumeName: resume.name })
        .where(eq(candidates.id, candidateId));
    }
  } else {
    const [created] = await ex
      .insert(candidates)
      .values({ ...candidate, resumeKey: resume?.key, resumeName: resume?.name })
      .returning({ id: candidates.id });
    candidateId = created.id;
  }

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

  if (!application) return { candidateId, applicationId: null, created: false };

  await logActivity(ex, {
    applicationId: application.id,
    actorId: input.actorId,
    type: input.actorId ? "added" : "applied",
    data: { source: candidate.source },
  });
  return { candidateId, applicationId: application.id, created: true };
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
    await logActivity(tx, {
      applicationId: app.id,
      actorId: user.id,
      type: "stage_changed",
      data: { from: app.stageId, to: stageId },
    });
  });
  return app;
}

/** Stage label a scorecard is filed under: the application's current stage. */
export async function currentStageName(stageId: string | null): Promise<string> {
  if (!stageId) return "General";
  const [stage] = await db().select({ name: stages.name }).from(stages).where(eq(stages.id, stageId));
  return stage?.name ?? "General";
}
