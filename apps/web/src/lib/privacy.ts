import { asc, eq, inArray, sql } from "drizzle-orm";
import {
  activity,
  applications,
  auditLog,
  candidates,
  emails,
  interviewInterviewers,
  interviews,
  jobs,
  notes,
  scorecards,
  settings,
  stages,
  users,
} from "@pennyats/db";
import { db } from "./db";
import { readPrivacySettings, retentionCutoff, type PrivacySettings } from "./privacy-rules";
import { storage } from "./storage";

// No Next.js imports in this file: the scheduled purge script (scripts/privacy-purge.mts) uses it too.

const SETTINGS_KEY = "privacy";

export async function getPrivacySettings(): Promise<PrivacySettings> {
  const [row] = await db().select().from(settings).where(eq(settings.key, SETTINGS_KEY));
  return readPrivacySettings(row?.value);
}

export async function savePrivacySettings(value: PrivacySettings, actorId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .insert(settings)
      .values({ key: SETTINGS_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ action: "privacy_settings_changed", actorId, data: { ...value } });
  });
}

export type AuditAction = "candidate_deleted" | "candidate_exported" | "retention_purge" | "privacy_settings_changed";

/**
 * Permanently delete candidates and everything attached to them: applications, stage
 * history, scorecards, notes, emails, and resume files. Writes one audit entry with the
 * count and reason only, never the person's details. Returns how many were deleted.
 */
export async function deleteCandidates(
  ids: string[],
  opts: { actorId: string | null; reason: string | null; action: "candidate_deleted" | "retention_purge" },
): Promise<number> {
  if (ids.length === 0) return 0;

  const deleted = await db().transaction(async (tx) => {
    // Related rows go with the candidate through ON DELETE CASCADE foreign keys.
    const rows = await tx
      .delete(candidates)
      .where(inArray(candidates.id, ids))
      .returning({ resumeKey: candidates.resumeKey });
    if (rows.length > 0) {
      await tx.insert(auditLog).values({
        action: opts.action,
        actorId: opts.actorId,
        data: { count: rows.length, ...(opts.reason ? { reason: opts.reason } : {}) },
      });
    }
    return rows;
  });

  // Files are removed after the database commit. If this fails, the files are orphaned
  // (nothing points to them) and a retry of the folder cleanup is safe.
  for (const row of deleted) {
    if (row.resumeKey) await storage.delete(row.resumeKey).catch(() => {});
  }
  return deleted.length;
}

/**
 * Candidates past the retention period: no active or hired application, and nothing has
 * happened on their record (applied, moved, noted, scored) since the cutoff.
 */
export async function expiredCandidateIds(months: number, now: Date = new Date()): Promise<string[]> {
  const cutoff = retentionCutoff(months, now);
  const rows = await db().execute<{ id: string }>(sql`
    select c.id from candidates c
    where not exists (
      select 1 from applications a
      where a.candidate_id = c.id and a.status in ('active', 'hired')
    )
    and greatest(
      c.created_at,
      (select max(greatest(a.applied_at, a.stage_changed_at)) from applications a where a.candidate_id = c.id),
      (select max(ac.created_at) from activity ac join applications a on a.id = ac.application_id where a.candidate_id = c.id),
      (select max(n.created_at) from notes n where n.candidate_id = c.id),
      (select max(s.updated_at) from scorecards s join applications a on a.id = s.application_id where a.candidate_id = c.id)
    ) < ${cutoff.toISOString()}::timestamptz
  `);
  // Raw sql params don't serialize Date objects with postgres-js, hence the ISO string and cast.
  return Array.from(rows, (r) => r.id);
}

/** Everything stored about one candidate, for a data access request. Null if not found. */
export async function exportCandidate(candidateId: string) {
  const [candidate] = await db().select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) return null;

  const apps = await db()
    .select({
      id: applications.id,
      job: jobs.title,
      stage: stages.name,
      status: applications.status,
      rejectionReason: applications.rejectionReason,
      appliedAt: applications.appliedAt,
      stageChangedAt: applications.stageChangedAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(stages, eq(stages.id, applications.stageId))
    .where(eq(applications.candidateId, candidateId))
    .orderBy(asc(applications.appliedAt));
  const appIds = apps.map((a) => a.id);

  const loop = appIds.length
    ? await db()
        .select({
          id: interviews.id,
          applicationId: interviews.applicationId,
          name: interviews.name,
          stage: interviews.stageName,
          durationMinutes: interviews.durationMinutes,
          scheduledAt: interviews.scheduledAt,
          completedAt: interviews.completedAt,
          cancelledAt: interviews.cancelledAt,
        })
        .from(interviews)
        .where(inArray(interviews.applicationId, appIds))
        .orderBy(asc(interviews.createdAt))
    : [];
  const loopPeople = loop.length
    ? await db()
        .select({ interviewId: interviewInterviewers.interviewId, name: users.name })
        .from(interviewInterviewers)
        .innerJoin(users, eq(users.id, interviewInterviewers.userId))
        .where(inArray(interviewInterviewers.interviewId, loop.map((i) => i.id)))
    : [];

  const [candidateNotes, cards, history, sent] = await Promise.all([
    db()
      .select({ author: users.name, body: notes.body, createdAt: notes.createdAt })
      .from(notes)
      .innerJoin(users, eq(users.id, notes.authorId))
      .where(eq(notes.candidateId, candidateId))
      .orderBy(asc(notes.createdAt)),
    appIds.length
      ? db()
          .select({
            applicationId: scorecards.applicationId,
            author: users.name,
            stage: scorecards.stageName,
            recommendation: scorecards.recommendation,
            ratings: scorecards.ratings,
            summary: scorecards.summary,
            updatedAt: scorecards.updatedAt,
          })
          .from(scorecards)
          .innerJoin(users, eq(users.id, scorecards.authorId))
          .where(inArray(scorecards.applicationId, appIds))
      : [],
    appIds.length
      ? db()
          .select({ applicationId: activity.applicationId, type: activity.type, data: activity.data, createdAt: activity.createdAt })
          .from(activity)
          .where(inArray(activity.applicationId, appIds))
          .orderBy(asc(activity.createdAt))
      : [],
    db().select().from(emails).where(eq(emails.candidateId, candidateId)),
  ]);

  const { resumeKey, ...profile } = candidate;
  return {
    exportedAt: new Date().toISOString(),
    profile: { ...profile, resumeOnFile: Boolean(resumeKey) },
    applications: apps.map(({ id, ...a }) => ({
      ...a,
      scorecards: cards.filter((c) => c.applicationId === id).map(({ applicationId, ...c }) => c),
      history: history.filter((h) => h.applicationId === id).map(({ applicationId, ...h }) => h),
      interviews: loop
        .filter((i) => i.applicationId === id)
        .map(({ id: interviewId, applicationId, ...i }) => ({
          ...i,
          interviewers: loopPeople.filter((p) => p.interviewId === interviewId).map((p) => p.name),
        })),
    })),
    notes: candidateNotes,
    emails: sent.map(({ candidateId: _, sentBy: __, ...e }) => e),
  };
}

export async function logAudit(action: AuditAction, actorId: string | null, data: Record<string, unknown> = {}) {
  await db().insert(auditLog).values({ action, actorId, data });
}
