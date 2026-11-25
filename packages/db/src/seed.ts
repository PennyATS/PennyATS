import { eq } from "drizzle-orm";
import { loadRootEnv } from "./env";
import { createDb, jobs, stages, candidates, applications, users } from "./index";

loadRootEnv();

const DEFAULT_STAGES = ["Applied", "Recruiter screen", "Technical interview", "Onsite", "Offer"];

const db = createDb();

const ADMIN_EMAIL = "admin@example.com";

await db
  .insert(users)
  .values({ email: ADMIN_EMAIL, name: "Demo Admin", role: "admin" })
  .onConflictDoNothing();

// Look the admin up rather than relying on RETURNING, which is empty on a re-run.
const [admin] = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL));

// One transaction so a failed run never leaves a job without stages or candidates.
const job = await db.transaction(async (tx) => {
  const [job] = await tx
    .insert(jobs)
    .values({
      slug: "senior-software-engineer",
      title: "Senior Software Engineer",
      department: "Engineering",
      location: "Remote (US)",
      description: "Demo job created by the seed script.",
      status: "open",
      createdBy: admin.id,
    })
    .onConflictDoNothing()
    .returning();
  if (!job) return undefined;

  const createdStages = await tx
    .insert(stages)
    .values(DEFAULT_STAGES.map((name, position) => ({ jobId: job.id, name, position })))
    .returning();

  // Synthetic people only. Never put real candidate data in the seed.
  const demoCandidates = await tx
    .insert(candidates)
    .values([
      { fullName: "Jordan Lee", email: "jordan@example.com", source: "Referral" },
      { fullName: "Sam Rivera", email: "sam@example.com", source: "Careers page" },
      { fullName: "Priya Shah", email: "priya@example.com", source: "Outbound" },
    ])
    .returning();

  await tx.insert(applications).values(
    demoCandidates.map((c, i) => ({
      candidateId: c.id,
      jobId: job.id,
      stageId: createdStages[Math.min(i, createdStages.length - 1)].id,
    })),
  );
  return job;
});

console.log(job ? "Seed complete." : "Demo job already exists; nothing to seed.");
process.exit(0);
