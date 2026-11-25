import { and, eq, isNull } from "drizzle-orm";
import { interviewInterviewers, interviews, jobs, scorecards } from "@pennyats/db";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { currentStageName, getApplicationFor } from "./hiring";
import { scorecardAttributes } from "./interviews";
import { canManageHiring } from "./permissions";
import { isUuid } from "./validation";

/**
 * What a scorecard form is about. Shared by the scorecard page and its action so both agree
 * on the attributes (and their order, which the form's field names depend on).
 *
 * With an interview: only its assigned interviewers, or recruiters and admins, may submit.
 * Without one: a stage-level scorecard, as before the interview loop existed.
 */
export async function loadScorecardContext(user: SessionUser, applicationId: string, interviewId: string | null) {
  const app = isUuid(applicationId) ? await getApplicationFor(user, applicationId) : null;
  if (!app) return null;
  const [job] = await db()
    .select({ title: jobs.title, attributes: jobs.scorecardAttributes })
    .from(jobs)
    .where(eq(jobs.id, app.jobId));
  if (!job) return null;

  if (interviewId) {
    if (!isUuid(interviewId)) return null;
    const [interview] = await db()
      .select()
      .from(interviews)
      .where(and(eq(interviews.id, interviewId), eq(interviews.applicationId, app.id)));
    if (!interview || interview.cancelledAt) return null;
    const [assigned] = await db()
      .select({ userId: interviewInterviewers.userId })
      .from(interviewInterviewers)
      .where(and(eq(interviewInterviewers.interviewId, interview.id), eq(interviewInterviewers.userId, user.id)));
    if (!assigned && !canManageHiring(user.role)) return null;

    const [existing] = await db()
      .select()
      .from(scorecards)
      .where(and(eq(scorecards.interviewId, interview.id), eq(scorecards.authorId, user.id)));
    return {
      app,
      job,
      interview,
      stageName: interview.stageName,
      attributes: scorecardAttributes(interview.attributes, job.attributes),
      existing,
    };
  }

  const stageName = await currentStageName(app.stageId);
  const [existing] = await db()
    .select()
    .from(scorecards)
    .where(
      and(
        eq(scorecards.applicationId, app.id),
        eq(scorecards.authorId, user.id),
        eq(scorecards.stageName, stageName),
        isNull(scorecards.interviewId),
      ),
    );
  return { app, job, interview: null, stageName, attributes: job.attributes, existing };
}
