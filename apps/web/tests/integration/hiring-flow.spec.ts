import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { activity, applications, candidates, createDb, jobs, scorecards, stages } from "@pennyats/db";
import { expect, test } from "@playwright/test";

const db = createDb(process.env.TEST_DATABASE_URL);

test("a candidate moves from application to scorecard", async ({ page }) => {
  const [job] = await db
    .select({ id: jobs.id, slug: jobs.slug })
    .from(jobs)
    .where(eq(jobs.slug, "senior-software-engineer"));
  if (!job) throw new Error("Synthetic seed job is missing. Run pnpm test:integration from the repo root.");

  const pipeline = await db
    .select({ id: stages.id, name: stages.name })
    .from(stages)
    .where(eq(stages.jobId, job.id))
    .orderBy(asc(stages.position));
  if (pipeline.length < 2) throw new Error("Synthetic seed job needs at least two pipeline stages.");

  const suffix = randomUUID().slice(0, 8);
  const name = `Integration Candidate ${suffix}`;
  const email = `integration-${suffix}@example.com`;
  const summary = `Synthetic interview feedback ${suffix}`;

  await test.step("sign in", async () => {
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("pennyats-demo");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  let candidateId = "";
  let applicationId = "";
  await test.step("apply through the public careers page", async () => {
    await page.goto(`/careers/${job.slug}`);
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(page.getByRole("status")).toContainText("Thanks for applying");

    await expect.poll(async () => {
      const rows = await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.email, email));
      return rows.length;
    }).toBe(1);
    const [candidate] = await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.email, email));
    candidateId = candidate.id;
    const [application] = await db.select().from(applications).where(eq(applications.candidateId, candidateId));
    expect(application.jobId).toBe(job.id);
    expect(application.stageId).toBe(pipeline[0].id);
    expect(application.status).toBe("active");
    applicationId = application.id;
  });

  await test.step("move the candidate on the pipeline board", async () => {
    await page.goto(`/jobs/${job.id}?view=board`);
    const card = page.locator(`[data-card-id="${applicationId}"]`);
    await expect(card).toContainText(name);
    await card.getByRole("button", { name: `Move ${name} forward to ${pipeline[1].name}` }).click();
    await expect(page.locator(`[data-stage-id="${pipeline[1].id}"] [data-card-id="${applicationId}"]`)).toBeVisible();
    await expect.poll(async () => {
      const [application] = await db.select({ stageId: applications.stageId }).from(applications).where(eq(applications.id, applicationId));
      return application.stageId;
    }).toBe(pipeline[1].id);
  });

  await test.step("submit an interview scorecard", async () => {
    await page.goto(`/applications/${applicationId}/scorecard`);
    await page.getByRole("radio", { name: "Yes", exact: true }).check();
    await page.getByLabel("Summary").fill(summary);
    await page.getByRole("button", { name: "Submit scorecard" }).click();
    await expect(page).toHaveURL(new RegExp(`/candidates/${candidateId}$`));
    await expect(page.getByText(summary)).toBeVisible();

    await expect.poll(async () => {
      const rows = await db.select().from(scorecards).where(eq(scorecards.applicationId, applicationId));
      return rows.length;
    }).toBe(1);
    const [card] = await db.select().from(scorecards).where(eq(scorecards.applicationId, applicationId));
    expect(card.recommendation).toBe("yes");
    expect(card.stageName).toBe(pipeline[1].name);
    expect(card.summary).toBe(summary);
    const events = await db.select({ type: activity.type }).from(activity).where(eq(activity.applicationId, applicationId));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["applied", "stage_changed", "scorecard_submitted"]));
  });
});
