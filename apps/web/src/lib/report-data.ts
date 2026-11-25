import { and, asc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { activity, applications, candidates, jobs, scorecards, stages, users } from "@pennyats/db";
import { db } from "./db";
import { periodStart, type Period, type ReportApp, type ReportInput } from "./reports";

/** Load everything the reports need for one job (or all) and period. Callers check permissions. */
export async function loadReportInput(jobId: string | null, period: Period): Promise<ReportInput> {
  const start = periodStart(period);
  // Every query is limited to applications in the selected job and period.
  const appFilter: SQL | undefined = and(
    jobId ? eq(applications.jobId, jobId) : undefined,
    start ? gte(applications.appliedAt, start) : undefined,
  );

  const [allJobs, appRows, eventRows, stageRows, cardRows] = await Promise.all([
    db()
      .select({ id: jobs.id, title: jobs.title, location: jobs.location, status: jobs.status })
      .from(jobs)
      .orderBy(asc(jobs.title)),
    db()
      .select({
        id: applications.id,
        jobId: applications.jobId,
        status: applications.status,
        source: candidates.source,
        appliedAt: applications.appliedAt,
        stageId: applications.stageId,
        rejectionReason: applications.rejectionReason,
      })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .where(appFilter),
    db()
      .select({
        applicationId: applications.id,
        type: activity.type,
        data: activity.data,
        createdAt: activity.createdAt,
      })
      .from(activity)
      .innerJoin(applications, eq(applications.id, activity.applicationId))
      .where(and(appFilter, inArray(activity.type, ["stage_changed", "hired", "rejected", "withdrawn"]))),
    db()
      .select({ id: stages.id, jobId: stages.jobId, name: stages.name, position: stages.position })
      .from(stages)
      .where(jobId ? eq(stages.jobId, jobId) : undefined),
    db()
      .select({ author: users.name, recommendation: scorecards.recommendation })
      .from(scorecards)
      .innerJoin(applications, eq(applications.id, scorecards.applicationId))
      .innerJoin(users, eq(users.id, scorecards.authorId))
      .where(appFilter),
  ]);

  return {
    jobs: allJobs,
    jobId,
    apps: appRows as ReportApp[],
    events: eventRows,
    stages: stageRows,
    cards: cardRows,
  };
}
