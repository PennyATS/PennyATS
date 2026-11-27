import { and, asc, count, eq, gte, inArray, type SQL } from "drizzle-orm";
import { activity, applications, candidates, careersFunnelEvents, jobs, scorecards, stages, users } from "@pennyats/db";
import { withScorecardFacts } from "./db-context";
import { tallyCareersFunnel } from "./careers-funnel";
import { db } from "./db";
import { periodStart, type Period, type ReportApp, type ReportInput } from "./reports";

/**
 * Load everything the reports need for one job (or all) and period. Callers check the
 * permission and pass `scope` from `reportJobIds(user)`: null for every job, or the only job
 * ids whose data may be included.
 */
export async function loadReportInput(jobId: string | null, period: Period, scope: string[] | null): Promise<ReportInput> {
  const start = periodStart(period);
  // A job outside the scope reads as no data; an empty scope matches nothing.
  const jobIds = jobId ? (scope === null || scope.includes(jobId) ? [jobId] : []) : scope;
  const none = "00000000-0000-0000-0000-000000000000";
  const ids = jobIds && jobIds.length === 0 ? [none] : jobIds;
  // Every query is limited to applications in the selected jobs and period.
  const appFilter: SQL | undefined = and(
    ids ? inArray(applications.jobId, ids) : undefined,
    start ? gte(applications.appliedAt, start) : undefined,
  );
  const funnelFilter: SQL | undefined = and(
    ids ? inArray(careersFunnelEvents.jobId, ids) : undefined,
    start ? gte(careersFunnelEvents.createdAt, start) : undefined,
  );

  const [allJobs, appRows, eventRows, stageRows, cardRows, funnelRows] = await Promise.all([
    db()
      .select({ id: jobs.id, title: jobs.title, location: jobs.location, status: jobs.status })
      .from(jobs)
      .where(scope ? inArray(jobs.id, scope.length ? scope : [none]) : undefined)
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
      .where(ids ? inArray(stages.jobId, ids) : undefined),
    // Reports show recommendation counts per interviewer, never scorecard content (#119).
    withScorecardFacts(() =>
      db()
        .select({ author: users.name, recommendation: scorecards.recommendation })
        .from(scorecards)
        .innerJoin(applications, eq(applications.id, scorecards.applicationId))
        .innerJoin(users, eq(users.id, scorecards.authorId))
        .where(appFilter),
    ),
    db()
      .select({ kind: careersFunnelEvents.kind, count: count() })
      .from(careersFunnelEvents)
      .where(funnelFilter)
      .groupBy(careersFunnelEvents.kind),
  ]);

  return {
    jobs: allJobs,
    jobId,
    apps: appRows as ReportApp[],
    events: eventRows,
    stages: stageRows,
    cards: cardRows,
    applyFunnel: tallyCareersFunnel(funnelRows.map((r) => ({ kind: r.kind, count: Number(r.count) }))),
  };
}
