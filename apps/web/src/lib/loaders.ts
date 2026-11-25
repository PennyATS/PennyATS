import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { jobs, stages } from "@pennyats/db";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { canSeeJob } from "./hiring";
import { isUuid } from "./validation";

/** Load a job the user may see, with its stages in order, or 404. */
export async function loadJob(user: SessionUser, jobId: string) {
  if (!isUuid(jobId) || !(await canSeeJob(user, jobId))) notFound();
  const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) notFound();
  const jobStages = await db()
    .select()
    .from(stages)
    .where(eq(stages.jobId, jobId))
    .orderBy(asc(stages.position));
  return { job, stages: jobStages };
}
