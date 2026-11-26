/**
 * Drives the real MCP server end to end: the pennyats-mcp CLI as a child process, over stdio and
 * over streamable HTTP, against the running app and the seeded test database.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, desc, eq } from "drizzle-orm";
import { applications, auditLog, candidates, notes } from "@pennyats/db";
import { expect, test } from "@playwright/test";
import { ALL_SCOPES, apiClient, db, deleteKeys, makeKey, scopesForRole, seededUsers } from "./api-helpers";

test.describe.configure({ mode: "serial" });

const APP_URL = "http://127.0.0.1:3100";
const mcpDir = join(__dirname, "../../../../packages/mcp");
const keyIds: string[] = [];

function serverEnv(extra: Record<string, string>) {
  // Only what the server needs, plus PATH and the Windows basics to start Node.
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "HOME", "USERPROFILE", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA"];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k]!;
  return { ...env, PENNYATS_URL: APP_URL, ...extra };
}

async function stdioClient(apiKey: string, flags: string[] = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/cli.ts", ...flags],
    cwd: mcpDir,
    env: serverEnv({ PENNYATS_API_KEY: apiKey }),
    stderr: "pipe",
  });
  const client = new Client({ name: "integration-client", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content.map((c) => c.text).join("\n");
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Errors are plain text.
  }
  return { isError: Boolean(result.isError), text, json };
}

let people: Awaited<ReturnType<typeof seededUsers>>;
let recruiterKey = "";
let adminKey = "";
let jobId = "";
let applicationId = "";
let candidateId = "";
let secondStage = { id: "", name: "" };
const suffix = randomUUID().slice(0, 8);
const name = `Mcp Candidate ${suffix}`;
const email = `mcp-${suffix}@example.com`;

test.beforeAll(async ({ request }) => {
  people = await seededUsers();
  const r = await makeKey(people.recruiter.id, scopesForRole("recruiter"), { name: "mcp recruiter" });
  const a = await makeKey(people.admin.id, ALL_SCOPES, { name: "mcp admin" });
  keyIds.push(r.id, a.id);
  recruiterKey = r.key;
  adminKey = a.key;

  const api = apiClient(request);
  const job = await api(adminKey, "createJob", { body: { title: `MCP Engineer ${suffix}`, status: "open" } });
  jobId = job.body.id;
  secondStage = job.body.stages[1];
  const created = await api(adminKey, "createCandidate", {
    body: { job_id: jobId, full_name: name, email, phone: "+1 415 555 0142", linkedin_url: "https://linkedin.com/in/mcp-test", tags: ["rust"] },
  });
  candidateId = created.body.candidate.id;
  applicationId = created.body.application_id;
  await api(adminKey, "submitScorecard", { params: { id: applicationId }, body: { recommendation: "yes", summary: "Solid." } });
});

test.afterAll(async () => {
  await deleteKeys(keyIds);
});

test("read-only over stdio: searches, reads, reports, and drafts, with contact details redacted", async () => {
  const client = await stdioClient(recruiterKey);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining(["search_candidates", "get_candidate", "list_jobs", "get_scorecards", "run_report", "draft_email", "list_applications"]),
    );
    for (const write of ["move_candidate_stage", "add_note", "reject_application", "send_email", "delete_candidate"]) expect(tools).not.toContain(write);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(["triage_new_applicants", "weekly_pipeline_summary"]));

    const me = await call(client, "whoami");
    expect(me.json.user.role).toBe("recruiter");

    const found = await call(client, "search_candidates", { query: `"${name}"` });
    expect(found.isError).toBe(false);
    expect(found.json.candidates).toHaveLength(1);
    expect(found.json.candidates[0].id).toBe(candidateId);
    expect(found.text).not.toContain(email);
    expect(found.json.candidates[0].email).toBe("[EMAIL_1]");

    const profile = await call(client, "get_candidate", { candidate_id: candidateId });
    expect(profile.json.full_name).toBe(name);
    expect(profile.json.applications[0].id).toBe(applicationId);
    expect(profile.text).not.toContain(email);
    expect(profile.text).not.toContain("555 0142");
    expect(profile.text).not.toContain("linkedin.com/in/mcp-test");

    const jobs = await call(client, "list_jobs", { status: "open" });
    expect(jobs.json.find((j: { id: string }) => j.id === jobId).stages.length).toBeGreaterThan(2);

    const apps = await call(client, "list_applications", { job_id: jobId });
    expect(apps.json.applications.map((a: { id: string }) => a.id)).toEqual([applicationId]);

    const cards = await call(client, "get_scorecards", { application_id: applicationId });
    expect(cards.json.data[0].summary).toBe("Solid.");

    const funnel = await call(client, "run_report", { report: "funnel", job_id: jobId, period: "all" });
    expect(funnel.isError).toBe(false);
    expect(funnel.json.rows.length).toBeGreaterThan(0);

    const templates = await call(client, "list_email_templates");
    const draft = await call(client, "draft_email", { application_id: applicationId, template_id: templates.json[0].id });
    expect(draft.json.to).toBe("[EMAIL_1]");
    expect(draft.json.body).not.toContain("{{");

    // Write tools aren't available at all in read-only mode.
    const blocked = await client
      .callTool({ name: "add_note", arguments: { candidate_id: candidateId, body: "x" } })
      .then((r) => Boolean((r as ToolResult).isError), () => true);
    expect(blocked).toBe(true);
    expect(await db.select().from(notes).where(eq(notes.candidateId, candidateId))).toHaveLength(0);
  } finally {
    await client.close();
  }
});

test("read-write over stdio: moves and notes are audited as agent actions; destructive tools wait for confirm", async () => {
  const client = await stdioClient(recruiterKey, ["--read-write"]);
  try {
    const moved = await call(client, "move_candidate_stage", { application_id: applicationId, stage_name: secondStage.name.toUpperCase() });
    expect(moved.isError).toBe(false);
    const [app] = await db.select().from(applications).where(eq(applications.id, applicationId));
    expect(app.stageId).toBe(secondStage.id);

    const note = await call(client, "add_note", { candidate_id: candidateId, body: "Agent: strong Rust background, advance to onsite." });
    expect(note.isError).toBe(false);
    const [saved] = await db.select().from(notes).where(eq(notes.candidateId, candidateId));
    expect(saved.authorId).toBe(people.recruiter.id);

    // Both writes are in the audit log as agent activity, with the MCP client's name.
    const entries = await db.select().from(auditLog).where(eq(auditLog.action, "api_write")).orderBy(desc(auditLog.createdAt)).limit(2);
    for (const entry of entries) {
      expect(entry.actorType).toBe("agent");
      expect(entry.actorId).toBe(people.recruiter.id);
      expect(String(entry.data.agent)).toContain("pennyats-mcp/");
      expect(String(entry.data.agent)).toContain("integration-client");
    }
    expect(entries.map((e) => e.data.route).sort()).toEqual(["/applications/{id}/move", "/candidates/{id}/notes"]);

    // Reject: a preview first, nothing changes until confirm: true.
    const reason = "Not enough relevant experience";
    const preview = await call(client, "reject_application", { application_id: applicationId, reason });
    expect(preview.json.nothing_was_done).toBe(true);
    expect(preview.json.preview.candidate).toBe(name);
    expect((await db.select().from(applications).where(eq(applications.id, applicationId)))[0].status).toBe("active");
    const rejected = await call(client, "reject_application", { application_id: applicationId, reason, confirm: true });
    expect(rejected.isError).toBe(false);
    expect((await db.select().from(applications).where(eq(applications.id, applicationId)))[0].status).toBe("rejected");

    // Send email: the preview shows the message; confirming fails clearly because the test server has no SMTP.
    const templates = await call(client, "list_email_templates");
    const emailPreview = await call(client, "send_email", { application_id: applicationId, template_id: templates.json[0].id });
    expect(emailPreview.json.nothing_was_done).toBe(true);
    expect(emailPreview.json.preview.subject).toBeTruthy();
    const sent = await call(client, "send_email", { application_id: applicationId, template_id: templates.json[0].id, confirm: true });
    expect(sent.isError).toBe(true);
    expect(sent.text).toContain("SMTP");

    // A recruiter's key can't delete, even with confirm.
    const denied = await call(client, "delete_candidate", { candidate_id: candidateId, confirm: true });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/forbidden|missing_scope/);
    expect(await db.select().from(candidates).where(eq(candidates.id, candidateId))).toHaveLength(1);
  } finally {
    await client.close();
  }
});

test("streamable HTTP: each request brings its own key; an admin agent can delete after confirming", async () => {
  const port = 3300 + Math.floor(Math.random() * 500);
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "--http", "--read-write", "--port", String(port)], {
    cwd: mcpDir,
    env: serverEnv({}) as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MCP HTTP server didn't start")), 30_000);
      child.stderr!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", (code) => reject(new Error(`MCP HTTP server exited with ${code}`)));
    });
    const url = new URL(`http://127.0.0.1:${port}/mcp`);

    const anonymous = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(anonymous.status).toBe(401);

    const client = new Client({ name: "integration-http-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${adminKey}` } } }));
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain("delete_candidate");
      const preview = await call(client, "delete_candidate", { candidate_id: candidateId });
      expect(preview.json.nothing_was_done).toBe(true);
      expect(preview.json.preview.candidate).toBe(name);
      expect(await db.select().from(candidates).where(eq(candidates.id, candidateId))).toHaveLength(1);

      const deleted = await call(client, "delete_candidate", { candidate_id: candidateId, confirm: true });
      expect(deleted.isError).toBe(false);
      expect(await db.select().from(candidates).where(eq(candidates.id, candidateId))).toHaveLength(0);

      const [entry] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "candidate_deleted"), eq(auditLog.actorType, "agent")))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      expect(entry.actorId).toBe(people.admin.id);
      expect(JSON.stringify(entry.data)).not.toContain(candidateId);
      expect(JSON.stringify(entry.data)).not.toContain(name);
    } finally {
      await client.close();
    }
  } finally {
    child.kill();
  }
});
