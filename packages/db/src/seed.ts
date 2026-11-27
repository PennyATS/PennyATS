import { eq, isNull } from "drizzle-orm";
import { loadRootEnv } from "./env";
import { seedSynthetic } from "./seed-synthetic";
import { readDbState } from "./db-state";
import { seedRefusal } from "./demo-guard";
import {
  createDb,
  jobs,
  stages,
  candidates,
  applications,
  users,
  instance,
  emailTemplateFolders,
  emailTemplates,
  hashPassword,
  DEFAULT_STAGES,
  roleIdFor,
} from "./index";

loadRootEnv();

const db = createDb();

// Never run the seed against a real deployment: it adds logins with a published password.
const state = await readDbState(db);
const refusal = state && seedRefusal(state);
if (refusal) {
  console.error(`Seed refused: ${refusal}`);
  process.exit(1);
}

// Demo login for local use only. Never run the seed against a real instance.
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "pennyats-demo";

const passwordHash = await hashPassword(ADMIN_PASSWORD);
await db
  .insert(users)
  .values({ email: ADMIN_EMAIL, name: "Demo Admin", roleId: await roleIdFor(db, "admin"), passwordHash })
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

// Demo email templates, filed in folders. Skipped once any folder exists.
const [anyFolder] = await db.select({ id: emailTemplateFolders.id }).from(emailTemplateFolders).limit(1);
if (!anyFolder) {
  const [screen, decisions] = await db.insert(emailTemplateFolders)
    .values([{ name: "Recruiter screen" }, { name: "Decisions" }]).returning();
  await db.insert(emailTemplates).values([
    {
      folderId: screen.id, createdBy: admin.id,
      name: "Recruiter screen invitation",
      subject: "Next steps for {{job_title}} at {{company_name}}",
      bodyHtml: "<p>Hi {{first_name}},</p><p>Thanks for applying for the <strong>{{job_title}}</strong> role. " +
        "We'd like to set up a 30-minute phone call with our recruiting team.</p>" +
        "<p>On the call we'll cover:</p><ul><li><p>Your background and what you're looking for</p></li>" +
        "<li><p>The team and the role</p></li><li><p>Timeline and next steps</p></li></ul>" +
        "<p>Reply with a few times that work for you this week.</p><p>Best,<br>The {{company_name}} team</p>",
      body: [
        "Hi {{first_name}},",
        "Thanks for applying for the {{job_title}} role. We'd like to set up a 30-minute phone call with our recruiting team.",
        "On the call we'll cover:",
        "- Your background and what you're looking for\n- The team and the role\n- Timeline and next steps",
        "Reply with a few times that work for you this week.",
        "Best,\nThe {{company_name}} team",
      ].join("\n\n"),
    },
    {
      folderId: decisions.id, createdBy: admin.id,
      name: "Not moving forward",
      subject: "Your application for {{job_title}}",
      bodyHtml: "<p>Hi {{first_name}},</p><p>Thank you for your interest in {{company_name}} and the time you spent with us. " +
        "We've decided not to move forward with your application for <strong>{{job_title}}</strong>.</p>" +
        "<p>We'll keep your details on file and may reach out about future roles.</p><p>Best,<br>The {{company_name}} team</p>",
      body: [
        "Hi {{first_name}},",
        "Thank you for your interest in {{company_name}} and the time you spent with us. " +
          "We've decided not to move forward with your application for {{job_title}}.",
        "We'll keep your details on file and may reach out about future roles.",
        "Best,\nThe {{company_name}} team",
      ].join("\n\n"),
    },
  ]);
  console.log("Demo email templates created.");
}

console.log("Seed complete.");
console.log(`Demo login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
console.log(`Also: recruiter@example.com and dana.interviewer@example.com (same password).`);
process.exit(0);
