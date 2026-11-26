import { eq } from "drizzle-orm";
import { candidates, jobs } from "@pennyats/db";
import { db } from "@/lib/db";
import { listApplications, loadApplication } from "@/lib/api/data";
import { ApiError, apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { sendStageEntryEmail } from "@/lib/candidate-email";
import { canSeeCandidate, canSeeJob, startApplication } from "@/lib/hiring";
import { deliverDueWebhooks } from "@/lib/webhooks";

export const GET = apiHandler(routes.listApplications, async ({ user, query }) => listApplications(user, query));

export const POST = apiHandler(routes.createApplication, async ({ user, body }) => {
  if (!(await canSeeCandidate(user, body.candidate_id))) throw notFound("Candidate");
  if (!(await canSeeJob(user, body.job_id))) throw notFound("Job");
  const [job] = await db().select({ id: jobs.id }).from(jobs).where(eq(jobs.id, body.job_id));
  if (!job) throw notFound("Job");
  const [candidate] = await db().select({ source: candidates.source }).from(candidates).where(eq(candidates.id, body.candidate_id));
  const result = await db().transaction((tx) =>
    startApplication(tx, { candidateId: body.candidate_id, jobId: job.id, actorId: user.id, source: candidate?.source ?? null }),
  );
  if (!result.created || !result.applicationId) throw new ApiError("conflict", "This candidate already has an application for this job.");
  await sendStageEntryEmail(result.applicationId, null, user.id);
  void deliverDueWebhooks();
  return loadApplication(user, result.applicationId);
});
