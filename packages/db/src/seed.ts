import { createDb, jobs, stages, candidates, applications, users } from "./index";

const DEFAULT_STAGES = ["Applied", "Recruiter screen", "Technical interview", "Onsite", "Offer"];

const db = createDb();

const [admin] = await db
  .insert(users)
  .values({ email: "admin@example.com", name: "Demo Admin", role: "admin" })
  .onConflictDoNothing()
  .returning();

const [job] = await db
  .insert(jobs)
  .values({
    slug: "senior-software-engineer",
    title: "Senior Software Engineer",
    department: "Engineering",
    location: "Remote (US)",
    description: "Demo job created by the seed script.",
    status: "open",
    createdBy: admin?.id,
  })
  .onConflictDoNothing()
  .returning();

if (job) {
  const createdStages = await db
    .insert(stages)
    .values(DEFAULT_STAGES.map((name, position) => ({ jobId: job.id, name, position })))
    .returning();

  const demoCandidates = await db
    .insert(candidates)
    .values([
      { fullName: "Jordan Lee", email: "jordan@example.com", source: "Referral" },
      { fullName: "Sam Rivera", email: "sam@example.com", source: "Careers page" },
      { fullName: "Priya Shah", email: "priya@example.com", source: "Outbound" },
    ])
    .returning();

  await db.insert(applications).values(
    demoCandidates.map((c, i) => ({
      candidateId: c.id,
      jobId: job.id,
      stageId: createdStages[Math.min(i, createdStages.length - 1)].id,
    })),
  );
}

console.log("Seed complete.");
process.exit(0);
