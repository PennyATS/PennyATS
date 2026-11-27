/**
 * Runs the reference integrations in examples/ against the running app and test database, and
 * checks the records they create or update: a sourcing tool, a scheduler, and an AI assistant.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { activity, applications, candidates, interviewTemplateInterviewers, interviewTemplates, interviews, notes, webhooks } from "@pennyats/db";
import { expect, test } from "@playwright/test";
import { newWebhookSecret, sealWebhookSecret } from "../../src/lib/webhooks";
import { apiClient, db, deleteKeys, makeKey, scopesForRole, seededUsers } from "./api-helpers";

test.describe.configure({ mode: "serial" });

const APP_URL = "http://127.0.0.1:3100";
const examplesDir = join(__dirname, "../../../../examples");
const suffix = randomUUID().slice(0, 8);
const keyIds: string[] = [];
let recruiterKey = "";
let jobId = "";
let pipeline: { id: string; name: string }[] = [];

function run(script: string, args: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: examplesDir,
    env: { ...process.env, PENNYATS_URL: APP_URL, ...env },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`${script} failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  const lines = result.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

test.beforeAll(async ({ request }) => {
  const people = await seededUsers();
  const k = await makeKey(people.recruiter.id, scopesForRole("recruiter"), { name: "example integrations", source: "Example Sourcer" });
  keyIds.push(k.id);
  recruiterKey = k.key;
  const job = await apiClient(request)(recruiterKey, "createJob", { body: { title: `Rust Platform Engineer ${suffix}`, status: "open" } });
  jobId = job.body.id;
  pipeline = job.body.stages;
  // An interview plan on the second stage, so moving a candidate there creates an interview to book.
  const [template] = await db
    .insert(interviewTemplates)
    .values({ jobId, stageId: pipeline[1].id, name: "Systems design", durationMinutes: 60 })
    .returning();
  await db.insert(interviewTemplateInterviewers).values({ templateId: template.id, userId: people.interviewer.id });
});

test.afterAll(async () => {
  await deleteKeys(keyIds);
});

const emails = ["rust.one", "go.two", "rust.three"].map((n) => `${n}-${suffix}@example.com`);

test("sourcing tool: pushes prospects with the key's source, and re-runs without duplicates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pennyats-prospects-"));
  const file = join(dir, "prospects.csv");
  writeFileSync(
    file,
    [
      "full_name,email,phone,linkedin_url,location,tags",
      `Rust One ${suffix},${emails[0]},,,"Austin, TX",rust;backend`,
      `Go Two ${suffix},${emails[1]},,,Remote,go`,
      `Rust Three ${suffix},${emails[2]},,,Toronto,rust`,
    ].join("\n"),
  );
  const first = run("sourcing/push-prospects.ts", ["--job", jobId, "--file", file], { PENNYATS_API_KEY: recruiterKey });
  expect(first).toEqual({ created: 3, updated: 0, failed: 0 });

  const rows = await db.select().from(candidates).where(inArray(candidates.email, emails));
  expect(rows).toHaveLength(3);
  expect(rows.every((c) => c.source === "Example Sourcer")).toBe(true);
  expect(rows.find((c) => c.email === emails[0])?.tags).toEqual(["rust", "backend"]);
  const apps = await db.select().from(applications).where(inArray(applications.candidateId, rows.map((r) => r.id)));
  const history = await db.select().from(activity).where(inArray(activity.applicationId, apps.map((a) => a.id)));
  expect(history.every((h) => h.data.integration === "example integrations" && h.data.via === "api")).toBe(true);

  // Again, with a new tag: nobody is duplicated, the tag is added.
  writeFileSync(file, ["full_name,email,phone,linkedin_url,location,tags", `Rust One ${suffix},${emails[0]},,,,rust;referred`].join("\n"));
  const second = run("sourcing/push-prospects.ts", ["--job", jobId, "--file", file], { PENNYATS_API_KEY: recruiterKey });
  expect(second).toEqual({ created: 0, updated: 1, failed: 0 });
  const [again] = await db.select().from(candidates).where(eq(candidates.email, emails[0]));
  expect(again.tags).toEqual(["rust", "backend", "referred"]);
});

test("AI assistant: triages the first stage over MCP, notes everyone, advances matches", async () => {
  const dry = run("ai-assistant/triage.ts", ["--job", jobId], { PENNYATS_API_KEY: recruiterKey });
  expect(dry).toEqual({ reviewed: 3, advanced: 0, applied: false });
  const ids = (await db.select({ id: candidates.id }).from(candidates).where(inArray(candidates.email, emails))).map((c) => c.id);
  expect(await db.select().from(notes).where(inArray(notes.candidateId, ids))).toHaveLength(0);

  const applied = run("ai-assistant/triage.ts", ["--job", jobId, "--apply"], { PENNYATS_API_KEY: recruiterKey });
  expect(applied).toEqual({ reviewed: 3, advanced: 2, applied: true });
  expect(await db.select().from(notes).where(inArray(notes.candidateId, ids))).toHaveLength(3);
  const apps = await db
    .select({ email: candidates.email, stageId: applications.stageId })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(eq(applications.jobId, jobId));
  expect(apps.find((a) => a.email === emails[0])?.stageId).toBe(pipeline[1].id);
  expect(apps.find((a) => a.email === emails[1])?.stageId).toBe(pipeline[0].id);
  expect(apps.find((a) => a.email === emails[2])?.stageId).toBe(pipeline[1].id);
});

test("scheduler: books interviews from a webhook, and from a sweep", async ({ request }) => {
  // The two advanced candidates entered the planned stage, so each has an interview to book.
  const waiting = await db
    .select({ id: interviews.id })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .where(and(eq(applications.jobId, jobId), eq(interviews.name, "Systems design")));
  expect(waiting).toHaveLength(2);

  // Sweep mode books what is already waiting.
  const swept = run("scheduler/scheduler.ts", ["--sweep", "--job", jobId], { PENNYATS_API_KEY: recruiterKey, SCHEDULER_TIME_ZONE: "America/New_York" });
  expect(swept).toEqual({ booked: 2 });
  const booked = await db.select().from(interviews).where(inArray(interviews.id, waiting.map((w) => w.id)));
  expect(booked.every((i) => i.scheduledAt && i.scheduledAt > new Date() && i.meetingLocation?.startsWith("https://meet.example.com/"))).toBe(true);
  // Same interviewer on both, so the second was pushed to a later slot instead of double-booking.
  expect(new Set(booked.map((i) => i.scheduledAt!.getTime())).size).toBe(2);

  // Webhook mode: move the held candidate into the planned stage and let the scheduler react.
  const secret = newWebhookSecret();
  const port = 4300 + Math.floor(Math.random() * 500);
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "scheduler/scheduler.ts", "--port", String(port)], {
    cwd: examplesDir,
    env: { ...process.env, PENNYATS_URL: APP_URL, PENNYATS_API_KEY: recruiterKey, WEBHOOK_SECRET: secret, SCHEDULER_TIME_ZONE: "Europe/Berlin" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const [hook] = await db
    .insert(webhooks)
    .values({ url: `http://127.0.0.1:${port}/webhooks`, events: ["application.stage_changed"], secretEncrypted: sealWebhookSecret(secret) })
    .returning();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("example scheduler didn't start")), 30_000);
      child.stderr!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const [held] = await db
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .where(and(eq(applications.jobId, jobId), eq(candidates.email, emails[1])));
    await apiClient(request)(recruiterKey, "moveApplication", { params: { id: held.id }, body: { stage_id: pipeline[1].id } });

    await expect
      .poll(
        async () => {
          const [row] = await db.select().from(interviews).where(eq(interviews.applicationId, held.id));
          return Boolean(row?.scheduledAt && row.scheduledTimeZone === "Europe/Berlin");
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const log = await db.select().from(activity).where(and(eq(activity.applicationId, held.id), eq(activity.type, "interview_scheduled")));
    expect(log).toHaveLength(1);
  } finally {
    child.kill();
    await db.delete(webhooks).where(eq(webhooks.id, hook.id));
  }
});
