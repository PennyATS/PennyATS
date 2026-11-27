import { and, eq, inArray, sql } from "drizzle-orm";
import { jobs } from "@pennyats/db";
import { db } from "@/lib/db";
import { before, decodeCursor, newestFirst, loadJob, pageOf, serializeJob, stagesFor } from "@/lib/api/data";
import { ApiError, apiHandler } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { visibleJobIds } from "@/lib/hiring";
import { checkPeople, createJob } from "@/lib/jobs";

export const GET = apiHandler(routes.listJobs, async ({ user, query }) => {
  const ids = await visibleJobIds(user);
  if (ids !== null && ids.length === 0) return { data: [], next_cursor: null };
  const cursor = decodeCursor(query.cursor);
  const rows = await db()
    .select()
    .from(jobs)
    .where(
      and(
        ids ? inArray(jobs.id, ids) : undefined,
        query.status ? eq(jobs.status, query.status) : undefined,
        before(sql`${jobs.createdAt}`, jobs.id, cursor),
      ),
    )
    .orderBy(...newestFirst(jobs.createdAt, jobs.id))
    .limit(query.limit + 1);
  const page = pageOf(rows, query.limit, (r) => ({ at: r.createdAt, id: r.id }));
  const allStages = await stagesFor(page.data.map((j) => j.id));
  return { data: page.data.map((j) => serializeJob(j, allStages)), next_cursor: page.next_cursor };
});

export const POST = apiHandler(routes.createJob, async ({ user, body }) => {
  const values = {
    title: body.title,
    status: body.status,
    department: body.department ?? null,
    team: body.team ?? null,
    location: body.location ?? null,
    region: body.region ?? null,
    headcount: body.headcount ?? null,
    description: body.description ?? null,
    employmentType: body.employment_type ?? null,
    workplaceType: body.workplace_type ?? null,
    hiringManagerId: body.hiring_manager_id ?? null,
    recruiterId: body.recruiter_id ?? null,
  };
  const problem = await checkPeople(values);
  if (problem) throw new ApiError("unprocessable", problem);
  const id = await createJob(values, user.id);
  return loadJob(user, id);
});
