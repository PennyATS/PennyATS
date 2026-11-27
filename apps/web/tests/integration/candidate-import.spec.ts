import { randomUUID } from "node:crypto";
import { eq, ne } from "drizzle-orm";
import { applications, auditLog, candidates, createDb, jobs, stages } from "@pennyats/db";
import { expect, test } from "@playwright/test";

const db = createDb(process.env.TEST_DATABASE_URL);

test("CSV import previews rows and remains idempotent on rerun", async ({ page }) => {
  const [job] = await db.select({ id: jobs.id, title: jobs.title })
    .from(jobs).where(eq(jobs.slug, "senior-software-engineer"));
  if (!job) throw new Error("Synthetic seed job is missing. Run pnpm test:integration from the repo root.");
  const [stage] = await db.select({ id: stages.id, name: stages.name })
    .from(stages).where(eq(stages.jobId, job.id));
  if (!stage) throw new Error("Synthetic seed stage is missing.");

  const suffix = randomUUID().slice(0, 8);
  const name = `Import Candidate ${suffix}`;
  const email = `import-${suffix}@example.com`;
  const csv = [
    "Candidate,Email Address,Job Title,Current Stage,Source,Applied At",
    `${name},${email},${job.title},${stage.name},Greenhouse,2024-04-02T09:30:00-07:00`,
    `${name},${email.toUpperCase()},${job.title},${stage.name},Greenhouse,2024-04-02T09:30:00-07:00`,
    `Invalid Candidate,not-an-email,${job.title},${stage.name},Greenhouse,2024-04-02`,
  ].join("\r\n");

  await page.goto("/candidates/import");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("pennyats-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await page.goto("/candidates/import");
  await expect(page.getByRole("heading", { name: "Import candidates" })).toBeVisible();

  await page.getByLabel("Candidate CSV file").setInputFiles({
    name: "greenhouse-candidates.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  await expect(page.getByText("1 ready · 1 repeated within file · 1 invalid")).toBeVisible();
  await expect(page.getByText(`Row 4: A valid email is required for safe duplicate matching.`)).toBeVisible();
  await page.getByRole("button", { name: "Import ready rows" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 1 applications. Skipped 1 duplicates. 1 rows failed.");

  const found = await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.email, email));
  expect(found).toHaveLength(1);
  const imported = await db.select().from(applications).where(eq(applications.candidateId, found[0].id));
  expect(imported).toHaveLength(1);
  expect(imported[0].jobId).toBe(job.id);
  expect(imported[0].stageId).toBe(stage.id);
  expect(imported[0].appliedAt.toISOString()).toBe("2024-04-02T16:30:00.000Z");
  const imports = await db.select({ data: auditLog.data }).from(auditLog).where(eq(auditLog.action, "workspace_imported"));
  expect(imports.some(({ data }) => data.via === "csv" && data.created_applications === 1)).toBe(true);

  await page.getByRole("button", { name: "Import ready rows" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 0 applications. Skipped 2 duplicates. 1 rows failed.");
  expect(await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.email, email))).toHaveLength(1);
  expect(await db.select({ id: applications.id }).from(applications).where(eq(applications.candidateId, found[0].id))).toHaveLength(1);

  const [otherJob] = await db.select({ id: jobs.id }).from(jobs).where(ne(jobs.id, job.id)).limit(1);
  if (!otherJob) throw new Error("Synthetic seed needs another job for generic CSV mapping.");
  await page.getByLabel("Candidate CSV file").setInputFiles({
    name: "generic.csv", mimeType: "text/csv", buffer: Buffer.from(`Person,Contact\n${name},${email}\n`),
  });
  await page.getByLabel("Full name").selectOption("Person");
  await page.getByLabel("Email").selectOption("Contact");
  await page.getByLabel("Job for all rows without a mapped job title").selectOption(otherJob.id);
  await expect(page.getByText("1 ready · 0 repeated within file · 0 invalid")).toBeVisible();
  await page.getByRole("button", { name: "Import ready rows" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 1 applications. Skipped 0 duplicates. 0 rows failed.");
  const allApplications = await db.select({ jobId: applications.jobId }).from(applications).where(eq(applications.candidateId, found[0].id));
  expect(allApplications.map((application) => application.jobId)).toEqual(expect.arrayContaining([job.id, otherJob.id]));
  expect(allApplications).toHaveLength(2);
});
