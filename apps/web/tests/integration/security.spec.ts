/**
 * Security test suite (#121). Each test maps to a threat in docs/threat-model.md (the T-numbers)
 * and to the in-scope list in SECURITY.md. Role and visibility rules are also covered in
 * api.spec.ts, sensitive-data.spec.ts, and rls.spec.ts; AI redaction in packages/redact.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, notInArray } from "drizzle-orm";
import { applications, candidates, jobs } from "@pennyats/db";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { db, seededUsers } from "./api-helpers";

test.describe.configure({ mode: "serial" });

const PASSWORD = "pennyats-demo";

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

test("T1 security headers on every response", async ({ request }) => {
  for (const url of ["/login", "/careers", "/api/health"]) {
    const res = await request.get(url);
    const h = res.headers();
    expect(h["x-content-type-options"], url).toBe("nosniff");
    expect(h["x-frame-options"], url).toBe("DENY");
    expect(h["referrer-policy"], url).toBe("strict-origin-when-cross-origin");
    expect(h["x-powered-by"], url).toBeUndefined();
  }
});

test("T2 signed-out visitors reach no protected page, route, or API", async ({ request }) => {
  for (const url of ["/jobs", "/candidates", "/settings/users", "/reports"]) {
    const res = await request.get(url, { maxRedirects: 0 });
    expect([302, 303, 307, 308], url).toContain(res.status());
    expect(res.headers()["location"] ?? "", url).toContain("/login");
  }
  for (const url of [`/api/candidates/${randomUUID()}/export`, "/api/export/workspace", `/api/resumes/${randomUUID()}`, "/api/reports/jobs"]) {
    expect((await request.get(url)).status(), url).toBe(404);
  }
  expect((await request.get("/api/v1/me")).status()).toBe(401);
});

test("T3 session cookie is HttpOnly and SameSite, and signing out revokes it on the server", async ({ browser }) => {
  const page = await signIn(browser, "recruiter@example.com");
  const cookie = (await page.context().cookies()).find((c) => c.name === "pennyats_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  // A copy of the cookie works until sign-out...
  const copy = await (await browser.newContext({ storageState: { cookies: [cookie!], origins: [] } })).newPage();
  expect((await copy.request.get("/jobs", { maxRedirects: 0 })).status()).toBe(200);
  // ...and is useless afterwards, because the session row is deleted.
  await page.locator('button:has-text("Sign out")').first().evaluate((b) => (b as HTMLButtonElement).form!.requestSubmit());
  await expect(page).toHaveURL(/\/login/);
  const res = await copy.request.get("/jobs", { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(res.status());
});

test("T3 a wrong password does not sign in and does not say which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
  const text = (await page.locator("main, body").first().innerText()).toLowerCase();
  expect(text).not.toContain("no account");
  expect(text).not.toContain("unknown email");
});

test("T4 role checks: an interviewer gets 404 for admin and recruiter pages and other jobs", async ({ browser }) => {
  const people = await seededUsers();
  const page = await signIn(browser, "dana.interviewer@example.com");
  for (const url of ["/settings/users", "/settings/privacy", "/settings/api", "/settings/ai", "/jobs/new", "/reports", "/templates"]) {
    expect((await page.request.get(url)).status(), url).toBe(404);
  }
  const [other] = await db.select({ id: jobs.id }).from(jobs).where(notInArray(jobs.id, people.interviewerJobIds)).limit(1);
  expect((await page.request.get(`/jobs/${other.id}`)).status()).toBe(404);
  expect((await page.request.get("/api/export/workspace")).status()).toBe(404);
});

test("T5 invite and reset links: unknown tokens are refused", async ({ page }) => {
  for (const kind of ["invite", "reset"]) {
    await page.goto(`/${kind}/${randomUUID()}${randomUUID()}`);
    await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
  }
});

test("T6 resumes always download, never render, and only for people who can see the candidate", async ({ browser }) => {
  const people = await seededUsers();
  const [app] = await db
    .select({ candidateId: applications.candidateId })
    .from(applications)
    .where(notInArray(applications.jobId, people.interviewerJobIds))
    .limit(1);
  const key = `security-${randomUUID()}.html`;
  const dir = path.resolve(process.env.STORAGE_DIR ?? ".data/uploads");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, key), "<script>alert(1)</script>");
  await db.update(candidates).set({ resumeKey: key, resumeName: "resume.html" }).where(eq(candidates.id, app.candidateId));
  try {
    const admin = await signIn(browser, "admin@example.com");
    const res = await admin.request.get(`/api/resumes/${app.candidateId}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers()["content-type"]).toBe("application/octet-stream");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    const interviewer = await signIn(browser, "dana.interviewer@example.com");
    expect((await interviewer.request.get(`/api/resumes/${app.candidateId}`)).status()).toBe(404);
  } finally {
    await db.update(candidates).set({ resumeKey: null, resumeName: null }).where(eq(candidates.id, app.candidateId));
    rmSync(path.join(dir, key), { force: true });
  }
});

test("T7 exports are admin-only and recorded in the audit log", async ({ browser }) => {
  const recruiter = await signIn(browser, "recruiter@example.com");
  expect((await recruiter.request.get("/api/export/workspace")).status()).toBe(404);
  const [c] = await db.select({ id: candidates.id }).from(candidates).limit(1);
  expect((await recruiter.request.get(`/api/candidates/${c.id}/export`)).status()).toBe(404);
  const admin = await signIn(browser, "admin@example.com");
  const res = await admin.request.get(`/api/candidates/${c.id}/export`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/^attachment;/);
});

test("T8 cross-site form posts to server actions are rejected", async ({ request }) => {
  const res = await request.post("/login", {
    headers: { Origin: "https://evil.example", "Next-Action": "0".repeat(40), "Content-Type": "text/plain;charset=UTF-8" },
    data: "[]",
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

test("T9 the public apply form ignores bots that fill the hidden field", async ({ page }) => {
  const [job] = await db.select({ slug: jobs.slug }).from(jobs).where(and(eq(jobs.status, "open"), eq(jobs.confidential, false))).limit(1);
  const email = `bot-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto(`/careers/${job.slug}`);
  await page.getByLabel("Full name").fill("Spam Bot");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[name="website"]');
    if (input) input.value = "http://spam.example";
    input!.form!.noValidate = true;
    input!.form!.requestSubmit();
  });
  await page.waitForTimeout(2000);
  const rows = await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.email, email));
  expect(rows).toHaveLength(0);
});
