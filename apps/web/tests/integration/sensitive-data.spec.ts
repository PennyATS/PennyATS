/**
 * Sensitive data visibility (#97), signed in as seeded users of different role presets:
 * compensation, phone screen notes (page and search), candidate records for executives,
 * CSV report exports, and privacy export. The API side is in api.spec.ts.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { applicationNotes, applications, jobs, users } from "@pennyats/db";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { db, seededUsers } from "./api-helpers";

test.describe.configure({ mode: "serial" });

const PASSWORD = "pennyats-demo";
const marker = randomUUID().slice(0, 8);
const screenText = `Phone screen marker ${marker}`;
let jobId = "";
let candidateId = "";

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

test.beforeAll(async () => {
  const people = await seededUsers();
  // A job the seeded interviewer is on, with a known pay band and a known phone screen note.
  jobId = people.interviewerJobIds[0];
  await db.update(jobs).set({ compCurrency: "USD", compPeriod: "year", compMin: 123456, compMax: 234567 }).where(eq(jobs.id, jobId));
  const [app] = await db
    .select({ id: applications.id, candidateId: applications.candidateId })
    .from(applications)
    .where(and(eq(applications.jobId, jobId), eq(applications.status, "active")))
    .limit(1);
  candidateId = app.candidateId;
  await db.delete(applicationNotes).where(and(eq(applicationNotes.applicationId, app.id), eq(applicationNotes.kind, "phone_screen")));
  await db.insert(applicationNotes).values({ applicationId: app.id, kind: "phone_screen", body: screenText });
});

test("recruiter: sees pay and phone screens, but no CSV export", async ({ browser }) => {
  const page = await signIn(browser, "recruiter@example.com");
  await page.goto(`/jobs/${jobId}?details=1`);
  await expect(page.getByText("123,456").first()).toBeVisible();
  // Job settings render for people who can edit the job and its pay.
  await page.goto(`/jobs/${jobId}/edit`);
  await expect(page.locator("#compMin")).toBeEnabled();
  await page.goto(`/candidates/${candidateId}`);
  await expect(page.locator('textarea[name="body"]').filter({ hasText: screenText })).toHaveCount(1);
  // Recruiters' reports cover their own jobs and have no CSV export (#95 matrix).
  expect((await page.request.get("/api/reports/funnel?period=all")).status()).toBe(404);
});

test("coordinator: no pay, phone screens read only", async ({ browser }) => {
  const page = await signIn(browser, "coordinator@example.com");
  await page.goto(`/jobs/${jobId}?details=1`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("123,456")).toHaveCount(0);
  expect((await page.request.get(`/jobs/${jobId}/edit`)).status()).toBe(404);
  await page.goto(`/candidates/${candidateId}`);
  await expect(page.getByText(screenText)).toBeVisible();
  await expect(page.getByLabel(/Phone screen notes for/)).toHaveCount(0);
  await page.goto(`/candidates?q=${encodeURIComponent(`"${marker}"`)}`);
  await expect(page.getByRole("main").locator(`a[href^="/candidates/${candidateId}"]`).first()).toBeVisible();
});

test("interviewer: no pay, no phone screens, and search can't reveal them", async ({ browser }) => {
  const page = await signIn(browser, "dana.interviewer@example.com");
  await page.goto(`/jobs/${jobId}?details=1`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("123,456")).toHaveCount(0);
  await page.goto(`/candidates/${candidateId}`);
  await expect(page.getByRole("heading", { name: "Phone screen notes" })).toHaveCount(0);
  await expect(page.getByText(screenText)).toHaveCount(0);
  await page.goto(`/candidates?q=${encodeURIComponent(`"${marker}"`)}`);
  await expect(page.getByRole("main").locator(`a[href^="/candidates/${candidateId}"]`)).toHaveCount(0);
  expect((await page.request.get(`/api/candidates/${candidateId}/export`)).status()).toBe(404);
});

test("hiring manager: sees pay read-only on their job's settings", async ({ browser }) => {
  const page = await signIn(browser, "hiring.manager@example.com");
  const [hm] = await db.select({ id: users.id }).from(users).where(eq(users.email, "hiring.manager@example.com"));
  const [managed] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.hiringManagerId, hm.id));
  await db.update(jobs).set({ compCurrency: "USD", compPeriod: "year", compMin: 111111, compMax: 222222 }).where(eq(jobs.id, managed.id));
  await page.goto(`/jobs/${managed.id}/edit`);
  await expect(page.locator("#compMin")).toBeDisabled();
  await expect(page.getByText("You can see the pay band but not change it.")).toBeVisible();
});

test("executive: aggregates and exports, no candidate records", async ({ browser }) => {
  const page = await signIn(browser, "executive@example.com");
  expect((await page.request.get("/candidates")).status()).toBe(404);
  expect((await page.request.get(`/candidates/${candidateId}`)).status()).toBe(404);
  expect((await page.request.get(`/jobs/${jobId}`)).status()).toBe(404);
  expect((await page.request.get("/api/reports/funnel?period=all")).status()).toBe(200);
  await page.goto("/dashboards/executive");
  await expect(page.getByText("Active candidates")).toBeVisible();
  await expect(page.getByRole("search")).toHaveCount(0);
});
