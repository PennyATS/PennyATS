import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, notExists, sql } from "drizzle-orm";
import {
  activity,
  applications,
  candidates,
  interviewInterviewers,
  interviews,
  jobs,
  scorecards,
  stages,
} from "@pennyats/db";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { jobIdsFor, visibleJobIds } from "./hiring";
import { FEEDBACK_DUE_DAYS } from "./interviews";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The signed-in user's own work: upcoming interviews and feedback they owe. */
export async function myWork(user: SessionUser) {
  const now = new Date();
  const base = db()
    .select({
      id: interviews.id,
      name: interviews.name,
      scheduledAt: interviews.scheduledAt,
      applicationId: interviews.applicationId,
      candidateId: candidates.id,
      candidate: candidates.fullName,
      job: jobs.title,
    })
    .from(interviews)
    .innerJoin(interviewInterviewers, and(eq(interviewInterviewers.interviewId, interviews.id), eq(interviewInterviewers.userId, user.id)))
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId));
  const [upcoming, owed] = await Promise.all([
    base
      .where(and(isNull(interviews.cancelledAt), gte(interviews.scheduledAt, sql`${now.toISOString()}::timestamptz`)))
      .orderBy(asc(interviews.scheduledAt))
      .limit(8),
    base
      .where(
        and(
          isNull(interviews.cancelledAt),
          isNotNull(interviews.scheduledAt),
          lt(interviews.scheduledAt, sql`${now.toISOString()}::timestamptz`),
          notExists(
            db()
              .select({ x: sql`1` })
              .from(scorecards)
              .where(and(eq(scorecards.interviewId, interviews.id), eq(scorecards.authorId, user.id))),
          ),
        ),
      )
      .orderBy(desc(interviews.scheduledAt))
      .limit(8),
  ]);
  return {
    upcoming,
    owed: owed.map((i) => ({ ...i, overdue: now.getTime() - i.scheduledAt!.getTime() > FEEDBACK_DUE_DAYS * DAY_MS })),
  };
}

/** Counts for the Activities card and open jobs with their active candidates. */
export async function teamActivity(user: SessionUser) {
  const ids = await visibleJobIds(user);
  if (ids !== null && ids.length === 0) return { reviewByJob: [], toSchedule: 0, overdue: 0, active: 0, openJobs: [] };
  const onJobs = ids ? inArray(applications.jobId, ids) : undefined;
  const overdueBefore = new Date(Date.now() - FEEDBACK_DUE_DAYS * DAY_MS).toISOString();

  const [reviewByJob, [toSchedule], [overdue], [active], openJobs] = await Promise.all([
    // Application review: active applications still in their job's first stage.
    db()
      .select({ jobId: jobs.id, job: jobs.title, n: count() })
      .from(applications)
      .innerJoin(stages, eq(stages.id, applications.stageId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(and(eq(applications.status, "active"), eq(stages.position, 0), onJobs))
      .groupBy(jobs.id, jobs.title)
      .orderBy(desc(count())),
    db()
      .select({ n: count() })
      .from(interviews)
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .where(and(eq(applications.status, "active"), isNull(interviews.scheduledAt), isNull(interviews.cancelledAt), isNull(interviews.completedAt), eq(interviews.stageId, applications.stageId), onJobs)),
    // Held more than FEEDBACK_DUE_DAYS ago with an interviewer who hasn't submitted.
    db()
      .select({ n: count() })
      .from(interviews)
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .where(
        and(
          isNull(interviews.cancelledAt),
          lt(interviews.scheduledAt, sql`${overdueBefore}::timestamptz`),
          onJobs,
          sql`exists (select 1 from ${interviewInterviewers} ii where ii.interview_id = ${interviews.id}
            and not exists (select 1 from ${scorecards} s where s.interview_id = ${interviews.id} and s.author_id = ii.user_id))`,
        ),
      ),
    db().select({ n: count() }).from(applications).where(and(eq(applications.status, "active"), onJobs)),
    db()
      .select({ id: jobs.id, title: jobs.title, location: jobs.location, department: jobs.department, active: sql<number>`count(${applications.id}) filter (where ${applications.status} = 'active')`.mapWith(Number) })
      .from(jobs)
      .leftJoin(applications, eq(applications.jobId, jobs.id))
      .where(and(eq(jobs.status, "open"), ids ? inArray(jobs.id, ids) : undefined))
      .groupBy(jobs.id)
      .orderBy(asc(jobs.title)),
  ]);
  return { reviewByJob, toSchedule: toSchedule.n, overdue: overdue.n, active: active.n, openJobs };
}

export const EXEC_PERIODS = {
  year: "This year",
  "90": "Last 90 days",
  "30": "Last 30 days",
  all: "All time",
} as const;
export type ExecPeriod = keyof typeof EXEC_PERIODS;

export function execPeriodStart(period: ExecPeriod, now = new Date()): Date | null {
  if (period === "all") return null;
  if (period === "year") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return new Date(now.getTime() - Number(period) * DAY_MS);
}

/** Numbers for the executive dashboard. Hires are dated by their "hired" activity. */
export async function executiveData(user: SessionUser, period: ExecPeriod, department: string | null) {
  const ids = await visibleJobIds(user);
  const since = execPeriodStart(period);
  const onJobs = ids ? inArray(applications.jobId, ids) : undefined;
  const inDept = department ? eq(jobs.department, department) : undefined;
  const now = new Date().toISOString();

  const [hires, interviewCounts, openJobs, active, departments] = await Promise.all([
    db()
      .select({ at: activity.createdAt, department: jobs.department })
      .from(activity)
      .innerJoin(applications, eq(applications.id, activity.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(
        and(
          eq(activity.type, "hired"),
          eq(applications.status, "hired"),
          since ? gte(activity.createdAt, sql`${since.toISOString()}::timestamptz`) : undefined,
          onJobs,
          inDept,
        ),
      ),
    db()
      .select({
        completed: sql<number>`count(*) filter (where ${interviews.scheduledAt} < ${now}::timestamptz)`.mapWith(Number),
        upcoming: sql<number>`count(*) filter (where ${interviews.scheduledAt} >= ${now}::timestamptz)`.mapWith(Number),
      })
      .from(interviews)
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(
        and(
          isNull(interviews.cancelledAt),
          isNotNull(interviews.scheduledAt),
          since ? gte(interviews.scheduledAt, sql`${since.toISOString()}::timestamptz`) : undefined,
          onJobs,
          inDept,
        ),
      ),
    db()
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.status, "open"), ids ? inArray(jobs.id, ids) : undefined, inDept)),
    db()
      .select({ n: count() })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(and(eq(applications.status, "active"), onJobs, inDept)),
    db()
      .selectDistinct({ d: jobs.department })
      .from(jobs)
      .where(and(isNotNull(jobs.department), ids ? inArray(jobs.id, ids) : undefined)),
  ]);

  return {
    hires,
    completedInterviews: interviewCounts[0]?.completed ?? 0,
    upcomingInterviews: interviewCounts[0]?.upcoming ?? 0,
    openJobs: openJobs[0].n,
    activeCandidates: active[0].n,
    departments: departments.map((d) => d.d!).sort((a, b) => a.localeCompare(b)),
  };
}

/** Open jobs with active candidates per stage, for the jobs dashboard. */
export async function jobsByStage(user: SessionUser, status: "open" | "all", mine = false) {
  const ids = await jobIdsFor(user, mine);
  if (ids !== null && ids.length === 0) return [];
  const jobRows = await db()
    .select({ id: jobs.id, title: jobs.title, location: jobs.location, department: jobs.department, status: jobs.status, workplaceType: jobs.workplaceType })
    .from(jobs)
    .where(and(status === "open" ? eq(jobs.status, "open") : undefined, ids ? inArray(jobs.id, ids) : undefined))
    .orderBy(asc(jobs.title));
  if (jobRows.length === 0) return [];
  const jobIds = jobRows.map((j) => j.id);
  const [stageRows, counts] = await Promise.all([
    db().select().from(stages).where(inArray(stages.jobId, jobIds)).orderBy(asc(stages.position)),
    db()
      .select({ stageId: applications.stageId, status: applications.status, n: count() })
      .from(applications)
      .where(inArray(applications.jobId, jobIds))
      .groupBy(applications.stageId, applications.status),
  ]);
  return jobRows.map((job) => {
    const jobStages = stageRows.filter((s) => s.jobId === job.id);
    const activeIn = (stageId: string) =>
      counts.filter((c) => c.stageId === stageId && c.status === "active").reduce((a, c) => a + c.n, 0);
    const stageIds = new Set(jobStages.map((s) => s.id));
    const archived = counts
      .filter((c) => c.stageId && stageIds.has(c.stageId) && (c.status === "rejected" || c.status === "withdrawn"))
      .reduce((a, c) => a + c.n, 0);
    const hired = counts.filter((c) => c.stageId && stageIds.has(c.stageId) && c.status === "hired").reduce((a, c) => a + c.n, 0);
    const stagesWithCounts = jobStages.map((s) => ({ id: s.id, name: s.name, active: activeIn(s.id) }));
    return { ...job, stages: stagesWithCounts, active: stagesWithCounts.reduce((a, s) => a + s.active, 0), hired, archived };
  });
}
