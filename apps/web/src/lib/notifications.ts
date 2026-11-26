import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { applications, candidates, interviews, jobTeam, jobs, notifications, users, type Db } from "@pennyats/db";
import { db } from "./db";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

export type NotificationKind = "application" | "stage_changed" | "interview_assigned";

type NewNotification = {
  userId: string;
  kind: NotificationKind;
  applicationId: string;
  interviewId?: string | null;
  data?: Record<string, string>;
};

/** Save notifications, skipping the person who caused them and duplicates. */
export async function notify(ex: Executor, actorId: string | null, rows: NewNotification[]): Promise<void> {
  const seen = new Set<string>();
  const values = rows.filter((r) => {
    const key = `${r.userId}:${r.kind}:${r.applicationId}:${r.interviewId ?? ""}`;
    if (r.userId === actorId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (values.length === 0) return;
  await ex.insert(notifications).values(values.map((v) => ({ ...v, interviewId: v.interviewId ?? null, actorId, data: v.data ?? {} })));
}

/**
 * Who hears about activity on a job: its recruiter and hiring manager, or, when neither is
 * set, the recruiters and admins on its hiring team.
 */
export async function jobWatchers(ex: Executor, jobId: string): Promise<string[]> {
  const [job] = await ex.select({ recruiterId: jobs.recruiterId, hiringManagerId: jobs.hiringManagerId }).from(jobs).where(eq(jobs.id, jobId));
  const named = [job?.recruiterId, job?.hiringManagerId].filter((id): id is string => Boolean(id));
  if (named.length) return named;
  const team = await ex
    .select({ id: users.id })
    .from(jobTeam)
    .innerJoin(users, eq(users.id, jobTeam.userId))
    .where(and(eq(jobTeam.jobId, jobId), eq(users.active, true), inArray(users.role, ["admin", "recruiter"])));
  return team.map((t) => t.id);
}

export type NotificationRow = {
  id: string;
  text: string;
  href: string;
  createdAt: Date;
  read: boolean;
};

/** Recent notifications for a user, newest first, with text built from current data. */
export async function loadNotifications(userId: string, limit = 12): Promise<{ rows: NotificationRow[]; unread: number }> {
  const [rows, [{ unread }]] = await Promise.all([
    db()
      .select({
        id: notifications.id,
        kind: notifications.kind,
        data: notifications.data,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        candidateId: candidates.id,
        candidate: candidates.fullName,
        job: jobs.title,
        interview: interviews.name,
        actor: users.name,
      })
      .from(notifications)
      .leftJoin(applications, eq(applications.id, notifications.applicationId))
      .leftJoin(candidates, eq(candidates.id, applications.candidateId))
      .leftJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(interviews, eq(interviews.id, notifications.interviewId))
      .leftJoin(users, eq(users.id, notifications.actorId))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db()
      .select({ unread: sql<number>`count(*)`.mapWith(Number) })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return {
    unread,
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      read: r.readAt !== null,
      href: r.candidateId ? `/candidates/${r.candidateId}` : "/",
      text: describeNotification(r.kind, {
        candidate: r.candidate ?? "A candidate",
        job: r.job ?? "a job",
        interview: r.interview ?? "an interview",
        actor: r.actor,
        stage: r.data.stage,
      }),
    })),
  };
}

export function describeNotification(
  kind: string,
  v: { candidate: string; job: string; interview: string; actor: string | null; stage?: string },
): string {
  switch (kind) {
    case "application":
      return v.actor ? `${v.actor} added ${v.candidate} to ${v.job}` : `${v.candidate} applied to ${v.job}`;
    case "stage_changed":
      return `${v.actor ?? "Someone"} moved ${v.candidate} to ${v.stage ?? "a new stage"} on ${v.job}`;
    case "interview_assigned":
      return `You're on ${v.interview} with ${v.candidate} for ${v.job}`;
    default:
      return "Something changed";
  }
}

export async function markRead(userId: string, id: string | null): Promise<void> {
  await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
}
