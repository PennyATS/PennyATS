/** Job creation helpers shared by the job form actions and the public API. */
import { and, eq, inArray, like, max, or } from "drizzle-orm";
import { DEFAULT_STAGES, jobTeam, jobs, stages, users, type Db } from "@pennyats/db";
import { db } from "./db";
import { slugify } from "./validation";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** "Senior Engineer" -> "senior-engineer", or "senior-engineer-2" if taken. */
export async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  const taken = await db()
    .select({ slug: jobs.slug })
    .from(jobs)
    .where(or(eq(jobs.slug, base), like(jobs.slug, `${base}-%`)));
  const used = new Set(taken.map((r) => r.slug));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** The hiring manager and recruiter must be active users; they join the hiring team so they can see the job. */
export async function checkPeople(value: { hiringManagerId?: string | null; recruiterId?: string | null }): Promise<string | null> {
  const ids = [value.hiringManagerId, value.recruiterId].filter((id): id is string => Boolean(id));
  if (ids.length === 0) return null;
  const found = await db().select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.active, true)));
  return found.length === new Set(ids).size ? null : "Pick an active user for the hiring manager and recruiter.";
}

export async function addPeopleToTeam(
  ex: Pick<ReturnType<typeof db>, "insert">,
  jobId: string,
  value: { hiringManagerId?: string | null; recruiterId?: string | null },
) {
  const ids = [...new Set([value.hiringManagerId, value.recruiterId].filter((id): id is string => Boolean(id)))];
  if (ids.length) await ex.insert(jobTeam).values(ids.map((userId) => ({ jobId, userId }))).onConflictDoNothing();
}

/** Insert a job with the default pipeline stages. Callers validate and check people first. */
export async function createJob(
  values: Omit<typeof jobs.$inferInsert, "slug" | "createdBy"> & { title: string },
  createdBy: string,
): Promise<string> {
  const slug = await uniqueSlug(values.title);
  return db().transaction(async (tx: Tx) => {
    const [job] = await tx.insert(jobs).values({ ...values, slug, createdBy }).returning({ id: jobs.id });
    await tx.insert(stages).values(DEFAULT_STAGES.map((name, position) => ({ jobId: job.id, name, position })));
    await addPeopleToTeam(tx, job.id, values);
    return job.id;
  });
}

/** Add a stage at the end of a job's pipeline. */
export async function appendStage(jobId: string, name: string) {
  const [{ top }] = await db().select({ top: max(stages.position) }).from(stages).where(eq(stages.jobId, jobId));
  const [stage] = await db().insert(stages).values({ jobId, name, position: (top ?? -1) + 1 }).returning();
  return stage;
}
