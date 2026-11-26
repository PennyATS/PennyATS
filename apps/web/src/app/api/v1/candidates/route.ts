import { desc, eq, sql, and } from "drizzle-orm";
import { candidates, jobs } from "@pennyats/db";
import { db } from "@/lib/db";
import { before, decodeCursor, loadCandidate, pageOf, serializeCandidate } from "@/lib/api/data";
import { ApiError, apiHandler, notFound } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { sendStageEntryEmail } from "@/lib/candidate-email";
import { candidateWhere, readFilters } from "@/lib/candidate-search";
import { addApplication, canSeeJob } from "@/lib/hiring";
import { addTags } from "@/lib/pipeline";
import { parseCandidate } from "@/lib/validation";
import { deliverDueWebhooks } from "@/lib/webhooks";

export const GET = apiHandler(routes.listCandidates, async ({ user, query }) => {
  // Same filters as the Candidates page, so the API and the app always agree.
  const filters = readFilters({
    q: query.q,
    name: query.name,
    email: query.email,
    source: query.source,
    job: query.job_id,
    stage: query.stage,
    status: query.status,
    tag: query.tag,
    from: query.created_from,
    to: query.created_to,
  });
  const where = await candidateWhere(user, filters);
  if (!where) return { data: [], next_cursor: null };
  const cursor = decodeCursor(query.cursor);
  const rows = await db()
    .select()
    .from(candidates)
    .where(and(where, before(sql`${candidates.createdAt}`, candidates.id, cursor)))
    .orderBy(desc(candidates.createdAt), desc(candidates.id))
    .limit(query.limit + 1);
  const page = pageOf(rows, query.limit, (r) => ({ at: r.createdAt, id: r.id }));
  return { data: page.data.map(serializeCandidate), next_cursor: page.next_cursor };
});

export const POST = apiHandler(routes.createCandidate, async ({ user, body }) => {
  if (!(await canSeeJob(user, body.job_id))) throw notFound("Job");
  const [job] = await db().select({ id: jobs.id }).from(jobs).where(eq(jobs.id, body.job_id));
  if (!job) throw notFound("Job");

  // The app's own parser, so the API applies exactly the same rules as the add-candidate form.
  const form = new FormData();
  for (const [name, value] of [
    ["fullName", body.full_name],
    ["email", body.email],
    ["phone", body.phone],
    ["linkedinUrl", body.linkedin_url],
    ["location", body.location],
  ] as const) {
    if (value) form.set(name, value);
  }
  const parsed = parseCandidate(form, { requireEmail: false });
  if (!parsed.ok) throw new ApiError("invalid_request", parsed.error);

  const result = await db().transaction((tx) =>
    addApplication(tx, {
      jobId: job.id,
      candidate: { ...parsed.value, source: body.source ?? "API" },
      actorId: user.id,
    }),
  );
  if (!result.created || !result.applicationId) {
    throw new ApiError("conflict", "This candidate already has an application for this job.", { candidate_id: result.candidateId });
  }
  if (body.tags?.length) await addTags(result.candidateId, body.tags);
  await sendStageEntryEmail(result.applicationId, null, user.id);
  void deliverDueWebhooks();
  return {
    candidate: await loadCandidate(user, result.candidateId),
    application_id: result.applicationId,
    created: true,
  };
});
