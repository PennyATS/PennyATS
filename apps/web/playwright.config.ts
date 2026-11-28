import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Set TEST_DATABASE_URL to a disposable local Postgres database ending in _test.");
}

const database = new URL(testDatabaseUrl);
if (
  !["postgres:", "postgresql:"].includes(database.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
  !decodeURIComponent(database.pathname.slice(1)).endsWith("_test")
) {
  throw new Error("TEST_DATABASE_URL must point to local Postgres and a database ending in _test.");
}

const baseURL = "http://127.0.0.1:3100";
process.env.DATABASE_URL = testDatabaseUrl;
// Tests seal webhook secrets the server must open, so both sides use the same AUTH_SECRET.
process.env.AUTH_SECRET ||= "pennyats-integration-test-secret";

export default defineConfig({
  testDir: "./tests/integration",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  // CI also writes JUnit so the security suite's results can be published (#121).
  reporter: process.env.CI ? [["github"], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec next dev -p 3100",
    url: `${baseURL}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      // Set by scripts/run-integration.mjs: the app connects as the restricted role (#119).
      APP_DATABASE_URL: process.env.APP_DATABASE_URL ?? "",
      APP_URL: baseURL,
      AI_PROVIDER: "",
      AI_API_KEY: "",
      AUTH_SECRET: process.env.AUTH_SECRET,
      // Never send real mail from tests, even if the local .env configures SMTP.
      SMTP_HOST: "",
      // Retry failed webhook deliveries after 300ms instead of 30s.
      WEBHOOK_RETRY_BASE_MS: "300",
    },
  },
});
