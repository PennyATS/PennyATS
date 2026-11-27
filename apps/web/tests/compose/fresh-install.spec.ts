import { expect, test } from "@playwright/test";

// A fresh Compose install (#140): first-run setup, then a feature that needs AUTH_SECRET.
test("a fresh install can set up an admin and add a webhook", async ({ page }) => {
  await page.goto("/setup");
  await page.getByLabel("Your name").fill("Compose Admin");
  await page.getByLabel("Email").fill("owner@compose.test");
  await page.getByLabel(/^Password/).fill("compose-smoke-password");
  await page.getByLabel("Confirm password").fill("compose-smoke-password");
  await page.getByRole("button", { name: "Create admin account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/setup"));

  await page.goto("/settings/api");
  await page.getByLabel("URL", { exact: true }).fill("https://hooks.example.com/pennyats");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.getByText("This is its signing secret")).toBeVisible();
  await expect(page.getByText("https://hooks.example.com/pennyats")).toBeVisible();
});
