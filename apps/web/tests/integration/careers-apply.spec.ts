import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, jobs } from "@pennyats/db";
import { devices, expect, test } from "@playwright/test";

const db = createDb(process.env.TEST_DATABASE_URL);

test.describe("careers apply on a phone-sized viewport", () => {
  test.use({ ...devices["iPhone 13"] });

  test("lists roles and completes an application with labeled fields", async ({ page }) => {
    const [job] = await db
      .select({ id: jobs.id, slug: jobs.slug, title: jobs.title })
      .from(jobs)
      .where(eq(jobs.slug, "senior-software-engineer"));
    if (!job) throw new Error("Synthetic seed job is missing. Run pnpm test:integration from the repo root.");

    const suffix = randomUUID().slice(0, 8);
    const name = `Mobile Candidate ${suffix}`;
    const email = `mobile-${suffix}@example.com`;

    await page.goto("/careers");
    await expect(page.getByRole("heading", { name: "Open roles", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /Skip to content/i })).toHaveAttribute("href", "#careers-main");
    await page.getByRole("link", { name: job.title }).click();

    await expect(page.getByRole("heading", { name: job.title, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Apply", level: 2 })).toBeVisible();
    await expect(page.getByText("No account needed")).toBeVisible();

    // Labels stay associated for assistive tech and for getByLabel.
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Submit application" }).click();

    await expect(page.getByRole("heading", { name: "Application received", level: 3 })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Thanks for applying");
  });
});

test("desktop careers apply still works", async ({ page }) => {
  const [job] = await db
    .select({ slug: jobs.slug, title: jobs.title })
    .from(jobs)
    .where(eq(jobs.slug, "senior-software-engineer"));
  if (!job) throw new Error("Synthetic seed job is missing. Run pnpm test:integration from the repo root.");

  const suffix = randomUUID().slice(0, 8);
  await page.goto(`/careers/${job.slug}`);
  await page.getByLabel("Full name").fill(`Desktop Candidate ${suffix}`);
  await page.getByLabel("Email").fill(`desktop-${suffix}@example.com`);
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByRole("status")).toContainText("Thanks for applying");
});
