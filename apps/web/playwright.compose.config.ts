import { defineConfig, devices } from "@playwright/test";

// Runs against an app that is already running, such as the Docker Compose stack in CI (#140).
// It drives first-run setup, so point it only at a fresh, disposable install.
const baseURL = process.env.COMPOSE_BASE_URL;
if (!baseURL) throw new Error("Set COMPOSE_BASE_URL to a fresh, disposable PennyATS install, such as http://localhost:3000.");

export default defineConfig({
  testDir: "./tests/compose",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { ...devices["Desktop Chrome"], baseURL, screenshot: "only-on-failure", trace: "retain-on-failure" },
});
