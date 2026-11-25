import { eq, isNull } from "drizzle-orm";
import { loadRootEnv } from "./env";
import { seedSynthetic } from "./seed-synthetic";
import {
  createDb,
  jobs,
  stages,
  candidates,
  applications,
  users,
  instance,
  hashPassword,
  DEFAULT_STAGES,
} from "./index";

loadRootEnv();

const db = createDb();

// Demo login for local use only. Never run the seed against a real instance.
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "pennyats-demo";

const passwordHash = await hashPassword(ADMIN_PASSWORD);
await db
  .insert(users)
  .values({ email: ADMIN_EMAIL, name: "Demo Admin", role: "admin", passwordHash })
  // Databases seeded before login existed have a demo admin with no password.
  .onConflictDoUpdate({ target: users.email, set: { passwordHash }, setWhere: isNull(users.passwordHash) });

// The demo admin counts as the first admin, so skip the first-run setup screen.
await db
  .insert(instance)
  .values({ id: true, setupComplete: true })
  .onConflictDoUpdate({ target: instance.id, set: { setupComplete: true } });

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
      team: "Platform",
      location: "Remote (US)",
      region: "United States",
      headcount: 1,
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

console.log(job ? "Demo job created." : "Demo job already exists; skipped it.");

// A larger, realistic funnel of synthetic people so the board, reports and health checks have data.
const synthetic = await seedSynthetic(db, { adminId: admin.id, passwordHash });
console.log(
  synthetic
    ? `Synthetic data: ${synthetic.jobs} jobs, ${synthetic.candidates} candidates, ${synthetic.applications} applications, ` +
        `${synthetic.interviews} interviews, ${synthetic.scorecards} scorecards.`
    : "Synthetic data already exists; skipped it.",
);

console.log("Seed complete.");
console.log(`Demo login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
console.log(`Also: recruiter@example.com and dana.interviewer@example.com (same password).`);
process.exit(0);
