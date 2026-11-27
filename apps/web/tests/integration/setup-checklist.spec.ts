import { eq } from "drizzle-orm";
import { createDb, settings } from "@pennyats/db";
import { expect, test } from "@playwright/test";

// The integration server runs with no SMTP, Google, or AI settings, so every Test button
// takes its "not set up" path. Success wording is covered by setup-checklist.test.ts.
const db = createDb(process.env.TEST_DATABASE_URL);

test("an admin works through the setup checklist", async ({ page }) => {
  await db.delete(settings).where(eq(settings.key, "setup_checklist"));

  await test.step("sign in and find the checklist on Home", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("pennyats-demo");
    await page.getByRole("button", { name: "Sign in" }).click();
    const card = page.getByRole("region", { name: "Finish setting up" });
    await expect(card).toBeVisible();
    await card.getByRole("link", { name: "Open setup checklist" }).click();
    await expect(page.getByRole("heading", { name: "Setup checklist", level: 1 })).toBeVisible();
  });

  await test.step("done steps come from the seeded workspace", async () => {
    await expect(page.getByTestId("status-job")).toHaveText("Done");
    await expect(page.getByTestId("status-team")).toHaveText("Done");
    await expect(page.getByTestId("status-email")).toHaveText("To do");
  });

  await test.step("Test buttons explain what is missing in plain language", async () => {
    await page.getByRole("button", { name: "Test email" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Email is not set up yet" })).toBeVisible();
    await page.getByRole("button", { name: "Test calendar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Calendar connection is not available" })).toBeVisible();
    await page.getByRole("button", { name: "Test AI" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "everything else works without it" })).toBeVisible();
  });

  await test.step("steps can be skipped and revisited", async () => {
    await page.getByRole("button", { name: "Skip: Connect your calendar" }).click();
    await expect(page.getByTestId("status-calendar")).toHaveText("Skipped");
    await page.getByRole("button", { name: "Undo skip: Connect your calendar" }).click();
    await expect(page.getByTestId("status-calendar")).toHaveText("To do");
  });

  await test.step("skipping every open step finishes the checklist", async () => {
    for (const title of ["Name your company", "Connect email", "Connect your calendar", "Turn on AI (optional)"]) {
      await page.getByRole("button", { name: `Skip: ${title}` }).click();
      await expect(page.getByRole("button", { name: `Undo skip: ${title}` })).toBeVisible();
    }
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Finish setting up" })).toHaveCount(0);
  });

  await test.step("the checklist can be hidden and shown again", async () => {
    await page.goto("/settings/setup");
    await page.getByRole("button", { name: "Undo skip: Connect email" }).click();
    await page.getByRole("button", { name: "Hide this checklist from Home" }).click();
    await expect(page.getByRole("button", { name: "Show this checklist on Home again" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Finish setting up" })).toHaveCount(0);
    await page.goto("/settings/setup");
    await page.getByRole("button", { name: "Show this checklist on Home again" }).click();
    await expect(page.getByRole("button", { name: "Hide this checklist from Home" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Finish setting up" })).toBeVisible();
  });

  await db.delete(settings).where(eq(settings.key, "setup_checklist"));
});
