import { eq } from "drizzle-orm";
import { jobs } from "@pennyats/db";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/api/data";
import { ApiError, apiHandler } from "@/lib/api/handler";
import { routes } from "@/lib/api/routes";
import { addPeopleToTeam, checkPeople } from "@/lib/jobs";

export const GET = apiHandler(routes.getJob, async ({ user, params }) => loadJob(user, params.id));

export const PATCH = apiHandler(routes.updateJob, async ({ user, params, body }) => {
  await loadJob(user, params.id);
  const set: Partial<typeof jobs.$inferInsert> = {};
  if (body.title !== undefined) set.title = body.title;
  if (body.status !== undefined) set.status = body.status;
  if (body.department !== undefined) set.department = body.department;
  if (body.team !== undefined) set.team = body.team;
  if (body.location !== undefined) set.location = body.location;
  if (body.region !== undefined) set.region = body.region;
  if (body.headcount !== undefined) set.headcount = body.headcount;
  if (body.description !== undefined) set.description = body.description;
  if (body.employment_type !== undefined) set.employmentType = body.employment_type;
  if (body.workplace_type !== undefined) set.workplaceType = body.workplace_type;
  if (body.hiring_manager_id !== undefined) set.hiringManagerId = body.hiring_manager_id;
  if (body.recruiter_id !== undefined) set.recruiterId = body.recruiter_id;
  const problem = await checkPeople(set);
  if (problem) throw new ApiError("unprocessable", problem);
  // The slug stays the same on edit so careers page links keep working.
  await db().update(jobs).set({ ...set, updatedAt: new Date() }).where(eq(jobs.id, params.id));
  await addPeopleToTeam(db(), params.id, set);
  return loadJob(user, params.id);
});
