/**
 * Public API integration tests against a seeded database. Every endpoint is called with an
 * allowed key and with a key that lacks its scope (403 missing_scope); role limits are checked
 * with an over-scoped interviewer key (403 forbidden). Every successful response is parsed with
 * the route's published schema.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { activity, applications, auditLog, candidates, jobTeam, jobs, notes, stages } from "@pennyats/db";
import { expect, test } from "@playwright/test";
import { exportCandidate } from "../../src/lib/privacy";
import { routes, type RouteName } from "../../src/lib/api/routes";
import { REJECTION_REASONS } from "../../src/lib/candidate-review";
import { ALL_SCOPES, allBut, apiClient, db, deleteKeys, makeKey, scopesForRole, seededUsers } from "./api-helpers";

test.describe.configure({ mode: "serial" });

const coverage = new Map<string, Set<"allowed" | "denied">>(Object.keys(routes).map((n) => [n, new Set()]));
const keyIds: string[] = [];
const suffix = randomUUID().slice(0, 8);

let people: Awaited<ReturnType<typeof seededUsers>>;
let admin: string; // every scope, acts as the admin
let recruiter: string; // every scope a recruiter can use
let interviewer: string; // every scope an interviewer can use
let overscoped: string; // an interviewer key holding every scope, to prove the role still limits it
let noScopes: string; // a valid key with no scopes at all
let adminKeyId = "";

async function key(userId: string, scopes: readonly string[], opts: Parameters<typeof makeKey>[2] = {}) {
  const made = await makeKey(userId, scopes, opts);
  keyIds.push(made.id);
  return made;
}

test.beforeAll(async () => {
  people = await seededUsers();
  const a = await key(people.admin.id, ALL_SCOPES);
  admin = a.key;
  adminKeyId = a.id;
  recruiter = (await key(people.recruiter.id, scopesForRole("recruiter"))).key;
  interviewer = (await key(people.interviewer.id, scopesForRole("interviewer"))).key;
  overscoped = (await key(people.interviewer.id, ALL_SCOPES)).key;
  noScopes = (await key(people.admin.id, [])).key;
});

test.afterAll(async () => {
  await deleteKeys(keyIds);
});

test("public API: keys, scopes, visibility, privacy, and audit", async ({ request }) => {
  const call = apiClient(request, coverage);
  /** A key that has every scope except the route's own. */
  const denied = async (name: RouteName, opts: Parameters<typeof call>[2] = {}) => {
    const route = routes[name];
    const k = (await key(people.admin.id, route.scope ? allBut(route.scope) : [])).key;
    const res = await call(k, name, opts);
    expect(res.status, `${name} without ${route.scope}`).toBe(403);
    expect(res.body.error.code).toBe("missing_scope");
  };

  await test.step("authentication", async () => {
    const me = await call(admin, "me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("admin@example.com");
    expect(me.body.key.scopes).toContain("candidates:delete");
    expect((await call(noScopes, "me")).status).toBe(200);

    expect((await call(null, "me")).body.error.code).toBe("unauthorized");
    expect((await call("pats_nope", "me")).status).toBe(401);
    expect((await call(`${admin.slice(0, -2)}xx`, "me")).status).toBe(401);
    const expired = await key(people.admin.id, ALL_SCOPES, { expiresAt: new Date(Date.now() - 60_000) });
    expect((await call(expired.key, "me")).body.error.message).toContain("expired");
    const revoked = await key(people.admin.id, ALL_SCOPES, { revokedAt: new Date() });
    expect((await call(revoked.key, "me")).body.error.message).toContain("revoked");

    const unknown = await request.get("/api/v1/nothing-here", { headers: { Authorization: `Bearer ${admin}` } });
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).error.code).toBe("not_found");
  });

  await test.step("OpenAPI document is served and matches docs/", async () => {
    const res = await request.get("/api/v1/openapi.json");
    expect(res.ok()).toBe(true);
    const committed = readFileSync(join(__dirname, "../../../../docs/api/openapi.json"), "utf8").replace(/\r\n/g, "\n");
    expect(await res.text()).toBe(committed);
  });

  let jobId = "";
  let jobStages: { id: string; name: string }[] = [];
  await test.step("jobs and stages", async () => {
    const created = await call(admin, "createJob", {
      body: { title: `API Engineer ${suffix}`, status: "open", location: "Remote", workplace_type: "remote", headcount: 2 },
    });
    expect(created.status).toBe(201);
    jobId = created.body.id;
    expect(created.body.stages.length).toBeGreaterThan(2);
    jobStages = created.body.stages;
    expect((await call(recruiter, "createJob", { body: { title: `Recruiter job ${suffix}` } })).status).toBe(201);
    expect((await call(overscoped, "createJob", { body: { title: "Nope" } })).body.error.code).toBe("forbidden");
    expect((await call(admin, "createJob", { body: { title: "" } })).body.error.code).toBe("invalid_request");
    expect((await call(admin, "createJob", { body: { title: "x", surprise: 1 } })).status).toBe(400);
    await denied("createJob", { body: { title: "Denied" } });

    const list = await call(admin, "listJobs", { query: { limit: "2" } });
    expect(list.body.data).toHaveLength(2);
    expect(list.body.next_cursor).toBeTruthy();
    const next = await call(admin, "listJobs", { query: { limit: "2", cursor: list.body.next_cursor } });
    expect(next.body.data[0].id).not.toBe(list.body.data[0].id);
    expect((await call(admin, "listJobs", { query: { cursor: "garbage" } })).body.error.code).toBe("invalid_request");
    await denied("listJobs");

    // Interviewers only see jobs they are on the hiring team for.
    const theirs = await call(interviewer, "listJobs", { query: { limit: "100" } });
    expect(theirs.body.data.map((j: { id: string }) => j.id).sort()).toEqual([...people.interviewerJobIds].sort());
    expect((await call(interviewer, "getJob", { params: { id: jobId } })).status).toBe(404);

    expect((await call(admin, "getJob", { params: { id: jobId } })).body.title).toBe(`API Engineer ${suffix}`);
    expect((await call(admin, "getJob", { params: { id: "not-a-uuid" } })).status).toBe(404);
    await denied("getJob", { params: { id: jobId } });

    const patched = await call(recruiter, "updateJob", { params: { id: jobId }, body: { department: "Platform" } });
    expect(patched.body.department).toBe("Platform");
    expect(patched.body.location).toBe("Remote");
    expect((await call(overscoped, "updateJob", { params: { id: jobId }, body: { title: "x" } })).body.error.code).toBe("forbidden");
    await denied("updateJob", { params: { id: jobId }, body: { title: "x" } });

    expect((await call(admin, "listStages", { params: { id: jobId } })).body.data).toHaveLength(jobStages.length);
    await denied("listStages", { params: { id: jobId } });
    const stage = await call(admin, "createStage", { params: { id: jobId }, body: { name: "Reference check" } });
    expect(stage.status).toBe(201);
    expect(stage.body.position).toBe(jobStages.length);
    await denied("createStage", { params: { id: jobId }, body: { name: "x" } });
  });

  // Put the test interviewer on the new job's hiring team for the visibility and blind-scorecard checks.
  await db.insert(jobTeam).values({ jobId, userId: people.interviewer.id }).onConflictDoNothing();

  let candidateId = "";
  let applicationId = "";
  const email = `api-${suffix}@example.com`;
  await test.step("candidates", async () => {
    const created = await call(recruiter, "createCandidate", {
      body: { job_id: jobId, full_name: `API Candidate ${suffix}`, email: email.toUpperCase(), tags: ["#Backend", "remote"] },
    });
    expect(created.status).toBe(201);
    candidateId = created.body.candidate.id;
    applicationId = created.body.application_id;
    expect(created.body.candidate.email).toBe(email);
    expect(created.body.candidate.source).toBe("API");
    expect(created.body.candidate.tags).toEqual(["backend", "remote"]);
    expect(created.body.candidate.applications[0].stage_id).toBe(jobStages[0].id);
    const again = await call(recruiter, "createCandidate", { body: { job_id: jobId, full_name: "Same person", email } });
    expect(again.status).toBe(409);
    expect(again.body.error.details.candidate_id).toBe(candidateId);
    expect((await call(recruiter, "createCandidate", { body: { job_id: jobId, full_name: "Bad", email: "not-an-email" } })).status).toBe(400);
    expect((await call(overscoped, "createCandidate", { body: { job_id: jobId, full_name: "x" } })).body.error.code).toBe("forbidden");
    await denied("createCandidate", { body: { job_id: jobId, full_name: "x" } });

    // Stage history is logged, as the reports need.
    const [log] = await db.select().from(activity).where(eq(activity.applicationId, applicationId));
    expect(log.type).toBe("added");

    const found = await call(admin, "listCandidates", { query: { q: `"${email}"` } });
    expect(found.body.data.map((c: { id: string }) => c.id)).toEqual([candidateId]);
    expect((await call(admin, "listCandidates", { query: { tag: "backend", job_id: jobId } })).body.data).toHaveLength(1);
    expect((await call(interviewer, "listCandidates", { query: { q: `"${email}"` } })).body.data).toHaveLength(1);
    await denied("listCandidates");

    const one = await call(interviewer, "getCandidate", { params: { id: candidateId } });
    expect(one.body.applications).toHaveLength(1);
    await denied("getCandidate", { params: { id: candidateId } });
  });

  await test.step("tags and notes", async () => {
    expect((await call(interviewer, "listTags", { params: { id: candidateId } })).body.data).toEqual(["backend", "remote"]);
    await denied("listTags", { params: { id: candidateId } });
    const added = await call(recruiter, "addTags", { params: { id: candidateId }, body: { tags: ["Bay Area", "backend"] } });
    expect(added.body.data).toEqual(["backend", "remote", "bay-area"]);
    expect((await call(overscoped, "addTags", { params: { id: candidateId }, body: { tags: ["x"] } })).body.error.code).toBe("forbidden");
    await denied("addTags", { params: { id: candidateId }, body: { tags: ["x"] } });
    const removed = await call(recruiter, "removeTag", { params: { id: candidateId, tag: "remote" } });
    expect(removed.body.data).toEqual(["backend", "bay-area"]);
    await denied("removeTag", { params: { id: candidateId, tag: "backend" } });

    const note = await call(interviewer, "createNote", {
      params: { id: candidateId },
      body: { body: "Strong systems background." },
      headers: { "X-PennyATS-Agent": "integration-agent" },
    });
    expect(note.status).toBe(201);
    expect(note.body.author_id).toBe(people.interviewer.id);
    await denied("createNote", { params: { id: candidateId }, body: { body: "x" } });
    const listed = await call(admin, "listNotes", { params: { id: candidateId }, query: { limit: "1" } });
    expect(listed.body.data[0].body).toBe("Strong systems background.");
    await denied("listNotes", { params: { id: candidateId } });

    // Agent writes are audited as agent activity, with the key, and as the key's user.
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "api_write")).orderBy(desc(auditLog.createdAt)).limit(1);
    expect(entry.actorType).toBe("agent");
    expect(entry.actorId).toBe(people.interviewer.id);
    expect(entry.apiKeyId).toBeTruthy();
    expect(entry.data).toMatchObject({ method: "POST", route: "/candidates/{id}/notes", resource_id: candidateId, agent: "integration-agent" });
  });

  let secondJobId = "";
  await test.step("applications", async () => {
    const list = await call(admin, "listApplications", { query: { candidate_id: candidateId } });
    expect(list.body.data.map((a: { id: string }) => a.id)).toEqual([applicationId]);
    await denied("listApplications");
    expect((await call(interviewer, "getApplication", { params: { id: applicationId } })).body.job_id).toBe(jobId);
    await denied("getApplication", { params: { id: applicationId } });

    secondJobId = (await call(admin, "createJob", { body: { title: `Second ${suffix}`, status: "open" } })).body.id;
    const second = await call(recruiter, "createApplication", { body: { candidate_id: candidateId, job_id: secondJobId } });
    expect(second.status).toBe(201);
    expect((await call(recruiter, "createApplication", { body: { candidate_id: candidateId, job_id: secondJobId } })).status).toBe(409);
    expect((await call(recruiter, "createApplication", { body: { candidate_id: candidateId, job_id: randomUUID() } })).status).toBe(404);
    expect((await call(overscoped, "createApplication", { body: { candidate_id: candidateId, job_id: secondJobId } })).body.error.code).toBe("forbidden");
    await denied("createApplication", { body: { candidate_id: candidateId, job_id: secondJobId } });
    // The interviewer isn't on the second job, so they still see only one application.
    expect((await call(interviewer, "getCandidate", { params: { id: candidateId } })).body.applications).toHaveLength(1);
    // A candidate only on a job outside the interviewer's team is invisible to them.
    const outsider = await call(recruiter, "createCandidate", { body: { job_id: secondJobId, full_name: `Outsider ${suffix}` } });
    const outsiderId = outsider.body.candidate.id;
    expect((await call(interviewer, "getCandidate", { params: { id: outsiderId } })).status).toBe(404);
    expect((await call(interviewer, "listNotes", { params: { id: outsiderId } })).status).toBe(404);
    expect((await call(interviewer, "createNote", { params: { id: outsiderId }, body: { body: "x" } })).status).toBe(404);
    expect((await call(interviewer, "listCandidates", { query: { q: `"Outsider ${suffix}"` } })).body.data).toHaveLength(0);
    expect((await call(interviewer, "getApplication", { params: { id: outsider.body.application_id } })).status).toBe(404);

    const moved = await call(recruiter, "moveApplication", { params: { id: applicationId }, body: { stage_id: jobStages[1].id } });
    expect(moved.body.stage_id).toBe(jobStages[1].id);
    expect((await call(recruiter, "moveApplication", { params: { id: applicationId }, body: { stage_id: jobStages[1].id } })).status).toBe(409);
    const [otherJobStage] = await db.select().from(stages).where(eq(stages.jobId, secondJobId)).orderBy(asc(stages.position)).limit(1);
    expect((await call(recruiter, "moveApplication", { params: { id: applicationId }, body: { stage_id: otherJobStage.id } })).status).toBe(422);
    expect((await call(overscoped, "moveApplication", { params: { id: applicationId }, body: { stage_id: jobStages[2].id } })).body.error.code).toBe("forbidden");
    await denied("moveApplication", { params: { id: applicationId }, body: { stage_id: jobStages[2].id } });
    const history = await db.select().from(activity).where(and(eq(activity.applicationId, applicationId), eq(activity.type, "stage_changed")));
    expect(history).toHaveLength(1);
    expect(history[0].data).toMatchObject({ from: jobStages[0].id, to: jobStages[1].id });

    const noReason = await call(recruiter, "setApplicationStatus", { params: { id: second.body.id }, body: { status: "rejected" } });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details.allowed_reasons).toContain(REJECTION_REASONS[0]);
    const rejected = await call(recruiter, "setApplicationStatus", {
      params: { id: second.body.id },
      body: { status: "rejected", reason: REJECTION_REASONS[0], note: "Prefers the first role" },
    });
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.rejection_reason).toContain(REJECTION_REASONS[0]);
    expect((await call(recruiter, "moveApplication", { params: { id: second.body.id }, body: { stage_id: otherJobStage.id } })).status).toBe(422);
    const reopened = await call(recruiter, "setApplicationStatus", { params: { id: second.body.id }, body: { status: "active" } });
    expect(reopened.body.status).toBe("active");
    expect(reopened.body.rejection_reason).toBeNull();
    await denied("setApplicationStatus", { params: { id: second.body.id }, body: { status: "withdrawn" } });
  });

  await test.step("scorecards stay blind until you submit yours", async () => {
    const adminCard = await call(admin, "submitScorecard", {
      params: { id: applicationId },
      body: { recommendation: "strong_yes", ratings: { Communication: 4 }, summary: "Clear and direct." },
    });
    expect(adminCard.status).toBe(201);
    expect(adminCard.body.ratings).toEqual({ Communication: 4 });
    const bad = await call(admin, "submitScorecard", { params: { id: applicationId }, body: { recommendation: "yes", ratings: { Charisma: 3 } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.unknown).toEqual(["Charisma"]);
    await denied("submitScorecard", { params: { id: applicationId }, body: { recommendation: "yes" } });

    const before = await call(interviewer, "listScorecards", { params: { id: applicationId } });
    expect(before.body.data).toHaveLength(0);
    expect(before.body.hidden_count).toBe(1);
    const mine = await call(interviewer, "submitScorecard", { params: { id: applicationId }, body: { recommendation: "yes" } });
    expect(mine.body.author_id).toBe(people.interviewer.id);
    const after = await call(interviewer, "listScorecards", { params: { id: applicationId } });
    expect(after.body.data).toHaveLength(2);
    expect(after.body.hidden_count).toBe(0);
    // Submitting again edits the earlier scorecard.
    await call(interviewer, "submitScorecard", { params: { id: applicationId }, body: { recommendation: "no", summary: "Changed my mind." } });
    const edited = await call(admin, "listScorecards", { params: { id: applicationId } });
    expect(edited.body.data).toHaveLength(2);
    expect(edited.body.data.find((c: { author_id: string }) => c.author_id === people.interviewer.id).recommendation).toBe("no");
    await denied("listScorecards", { params: { id: applicationId } });
  });

  await test.step("interviews", async () => {
    const created = await call(recruiter, "createInterview", {
      params: { id: applicationId },
      body: { name: "Architecture deep dive", duration_minutes: 60, interviewer_ids: [people.interviewer.id] },
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("to_schedule");
    expect(created.body.interviewer_ids).toEqual([people.interviewer.id]);
    expect((await call(overscoped, "createInterview", { params: { id: applicationId }, body: { name: "x" } })).body.error.code).toBe("forbidden");
    await denied("createInterview", { params: { id: applicationId }, body: { name: "x" } });

    const listed = await call(interviewer, "listInterviews", { params: { id: applicationId } });
    expect(listed.body.data.some((i: { id: string }) => i.id === created.body.id)).toBe(true);
    await denied("listInterviews", { params: { id: applicationId } });

    // Scheduling, the way a scheduling tool would.
    const waiting = await call(recruiter, "listAllInterviews", { query: { status: "to_schedule", job_id: jobId } });
    expect(waiting.body.data.map((i: { id: string }) => i.id)).toContain(created.body.id);
    expect(waiting.body.data.every((i: { status: string }) => i.status === "to_schedule")).toBe(true);
    await denied("listAllInterviews");
    expect((await call(interviewer, "getInterview", { params: { id: created.body.id } })).body.job_id).toBe(jobId);
    await denied("getInterview", { params: { id: created.body.id } });

    const at = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
    at.setUTCHours(17, 0, 0, 0);
    const booked = await call(recruiter, "updateInterview", {
      params: { id: created.body.id },
      body: { scheduled_at: at.toISOString(), time_zone: "America/New_York", meeting_location: "https://meet.example.com/abc" },
    });
    expect(booked.body.status).toBe("scheduled");
    expect(booked.body.scheduled_at).toBe(at.toISOString());
    // The same interviewer can't be double-booked.
    const other = await call(recruiter, "createInterview", {
      params: { id: applicationId },
      body: { name: "Second panel", interviewer_ids: [people.interviewer.id] },
    });
    const clash = await call(recruiter, "updateInterview", {
      params: { id: other.body.id },
      body: { scheduled_at: new Date(at.getTime() + 15 * 60_000).toISOString(), time_zone: "America/New_York" },
    });
    expect(clash.status).toBe(409);
    expect((await call(recruiter, "updateInterview", { params: { id: other.body.id }, body: { scheduled_at: "2020-01-01T00:00:00Z", time_zone: "UTC" } })).status).toBe(400);
    expect((await call(recruiter, "updateInterview", { params: { id: other.body.id }, body: { scheduled_at: at.toISOString() } })).status).toBe(400);
    expect((await call(recruiter, "updateInterview", { params: { id: other.body.id }, body: { scheduled_at: at.toISOString(), time_zone: "Mars/Olympus" } })).status).toBe(400);
    const cancelled = await call(recruiter, "updateInterview", { params: { id: other.body.id }, body: { state: "cancel" } });
    expect(cancelled.body.status).toBe("cancelled");
    expect((await call(overscoped, "updateInterview", { params: { id: other.body.id }, body: { state: "restore" } })).body.error.code).toBe("forbidden");
    await denied("updateInterview", { params: { id: other.body.id }, body: { state: "restore" } });
    const scheduledLog = await db.select().from(activity).where(and(eq(activity.applicationId, applicationId), eq(activity.type, "interview_scheduled")));
    expect(scheduledLog).toHaveLength(1);

    const card = await call(interviewer, "submitScorecard", {
      params: { id: applicationId },
      body: { interview_id: created.body.id, recommendation: "strong_yes" },
    });
    expect(card.body.interview_id).toBe(created.body.id);
    const done = await call(admin, "listInterviews", { params: { id: applicationId } });
    expect(done.body.data.find((i: { id: string }) => i.id === created.body.id).status).toBe("complete");
  });

  await test.step("email templates, drafts, and sending", async () => {
    const templates = await call(recruiter, "listEmailTemplates");
    expect(templates.body.data.length).toBeGreaterThan(0);
    await denied("listEmailTemplates");
    const templateId = templates.body.data[0].id;

    const draft = await call(recruiter, "draftEmail", { params: { id: applicationId }, body: { template_id: templateId } });
    expect(draft.body.to).toBe(email);
    expect(draft.body.text).not.toContain("{{");
    expect((await call(recruiter, "draftEmail", { params: { id: applicationId }, body: { template_id: randomUUID() } })).status).toBe(404);
    expect((await call(overscoped, "draftEmail", { params: { id: applicationId }, body: { template_id: templateId } })).body.error.code).toBe("forbidden");
    await denied("draftEmail", { params: { id: applicationId }, body: { template_id: templateId } });

    // The test server has no SMTP, so sending is refused clearly rather than silently dropped.
    const sent = await call(recruiter, "sendEmail", { params: { id: applicationId }, body: { template_id: templateId } });
    expect(sent.status).toBe(422);
    expect(sent.body.error.message).toContain("SMTP");
    coverage.get("sendEmail")!.add("allowed");
    expect((await call(overscoped, "sendEmail", { params: { id: applicationId }, body: { template_id: templateId } })).body.error.code).toBe("forbidden");
    await denied("sendEmail", { params: { id: applicationId }, body: { template_id: templateId } });
  });

  await test.step("reports", async () => {
    const funnel = await call(recruiter, "getReport", { params: { table: "funnel" }, query: { job_id: jobId, period: "all" } });
    expect(funnel.body.head.length).toBeGreaterThan(0);
    expect(funnel.body.rows.length).toBeGreaterThan(0);
    expect((await call(recruiter, "getReport", { params: { table: "sources" } })).status).toBe(200);
    expect((await call(recruiter, "getReport", { params: { table: "bogus" } })).status).toBe(404);
    expect((await call(overscoped, "getReport", { params: { table: "funnel" } })).body.error.code).toBe("forbidden");
    await denied("getReport", { params: { table: "funnel" } });
  });

  await test.step("privacy: API data is exported and deleted like any other", async () => {
    const exported = await exportCandidate(candidateId);
    expect(exported?.profile.email).toBe(email);
    expect(exported?.notes.map((n) => n.body)).toContain("Strong systems background.");
    expect(exported?.applications.length).toBe(2);
    expect(exported?.applications.flatMap((a) => a.scorecards).length).toBe(3);

    expect((await call(recruiter, "deleteCandidate", { params: { id: candidateId } })).status).toBe(403);
    await denied("deleteCandidate", { params: { id: candidateId } });
    const gone = await call(admin, "deleteCandidate", { params: { id: candidateId } });
    expect(gone.body).toEqual({ deleted: true });
    expect((await call(admin, "getCandidate", { params: { id: candidateId } })).status).toBe(404);
    expect((await call(admin, "deleteCandidate", { params: { id: candidateId } })).status).toBe(404);
    expect(await db.select().from(candidates).where(eq(candidates.id, candidateId))).toHaveLength(0);
    expect(await db.select().from(notes).where(eq(notes.candidateId, candidateId))).toHaveLength(0);
    expect(await db.select().from(applications).where(eq(applications.candidateId, candidateId))).toHaveLength(0);

    // The audit log shows a deletion through the key, but nothing about who was deleted.
    const recent = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(5);
    const deletion = recent.find((r) => r.action === "candidate_deleted");
    expect(deletion?.actorType).toBe("api_key");
    expect(deletion?.apiKeyId).toBe(adminKeyId);
    const write = recent.find((r) => r.action === "api_write" && r.data.operation === "deleteCandidate");
    expect(write).toBeTruthy();
    for (const row of recent) {
      const text = JSON.stringify(row.data);
      expect(text).not.toContain(candidateId);
      expect(text).not.toContain(email);
      expect(text).not.toContain(`API Candidate ${suffix}`);
    }
  });

  await test.step("integration attribution: the key's source and the key in the history", async () => {
    const sourcer = await key(people.recruiter.id, ["candidates:write", "candidates:read"], { name: "Example sourcer", source: "Example Sourcing Tool" });
    const added = await call(sourcer.key, "createCandidate", { body: { job_id: jobId, full_name: `Sourced ${suffix}` } });
    expect(added.body.candidate.source).toBe("Example Sourcing Tool");
    const [entry] = await db.select().from(activity).where(eq(activity.applicationId, added.body.application_id));
    expect(entry.data).toMatchObject({ source: "Example Sourcing Tool", via: "api", integration: "Example sourcer" });
    expect(String(entry.data.key)).toMatch(/^pats_[0-9a-f]{8}_/);
    const own = await call(sourcer.key, "createCandidate", { body: { job_id: jobId, full_name: `Referred ${suffix}`, source: "Referral" } });
    expect(own.body.candidate.source).toBe("Referral");
    const me = await call(sourcer.key, "me");
    expect(me.body.key.source).toBe("Example Sourcing Tool");
    const sources = await call(admin, "getReport", { params: { table: "sources" }, query: { job_id: jobId, period: "all" } });
    expect(sources.body.rows.map((r: unknown[]) => r[0])).toContain("Example Sourcing Tool");
  });

  await test.step("paging never skips rows that share a timestamp", async () => {
    // One statement, so all three get the same now() to the microsecond, as rows from one
    // transaction (a bulk insert or an import) do. The cursor only carries milliseconds.
    const tag = `tie-${suffix}`;
    const tied = await db
      .insert(candidates)
      .values([1, 2, 3].map((n) => ({ fullName: `Tie ${n} ${suffix}`, tags: [tag] })))
      .returning({ id: candidates.id, createdAt: candidates.createdAt });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await call(admin, "listCandidates", { query: { tag, limit: "1", ...(cursor ? { cursor } : {}) } });
      seen.push(...page.body.data.map((c: { id: string }) => c.id));
      cursor = page.body.next_cursor ?? undefined;
    } while (cursor && seen.length < 10);
    expect(seen.sort()).toEqual(tied.map((t) => t.id).sort());
  });

  await test.step("every endpoint was called with an allowed and a denied key", async () => {
    const missing = [...coverage].filter(([name, seen]) => name !== "me" && (!seen.has("allowed") || !seen.has("denied")));
    expect(missing.map(([name, seen]) => `${name}: ${[...seen].join("+") || "none"}`)).toEqual([]);
  });
});

test("confidential jobs: only the hiring team sees them, and team changes apply on the next request (#96)", async ({ request }) => {
  const call = apiClient(request, coverage);
  const title = `Confidential ${suffix}`;
  const created = await call(admin, "createJob", { body: { title, status: "open" } });
  expect(created.status).toBe(201);
  const jobId: string = created.body.id;
  await db.update(jobs).set({ confidential: true }).where(eq(jobs.id, jobId));
  const candidate = await call(admin, "createCandidate", {
    body: { job_id: jobId, full_name: `Confidential Candidate ${suffix}`, email: `confidential-${suffix}@example.com` },
  });
  expect(candidate.status).toBe(201);
  const candidateId: string = candidate.body.candidate.id;
  const jobsReport = async (k: string) => JSON.stringify((await call(k, "getReport", { params: { table: "jobs" }, query: { period: "all" } })).body.rows);

  await test.step("a recruiter who is not on the team can't load it, its candidate, or see it in lists and reports", async () => {
    expect((await call(recruiter, "getJob", { params: { id: jobId } })).status).toBe(404);
    expect((await call(recruiter, "updateJob", { params: { id: jobId }, body: { department: "x" } })).status).toBe(404);
    const list = await call(recruiter, "listJobs", { query: { limit: "100" } });
    expect(list.body.data.map((j: { id: string }) => j.id)).not.toContain(jobId);
    expect((await call(recruiter, "getCandidate", { params: { id: candidateId } })).status).toBe(404);
    const search = await call(recruiter, "listCandidates", { query: { q: `"confidential-${suffix}@example.com"` } });
    expect(search.body.data).toHaveLength(0);
    expect(await jobsReport(recruiter)).not.toContain(title);
  });

  await test.step("admins (jobs.view_confidential) see it", async () => {
    expect((await call(admin, "getJob", { params: { id: jobId } })).status).toBe(200);
    expect(await jobsReport(admin)).toContain(title);
  });

  await test.step("joining the hiring team takes effect on the next request, and leaving it does too", async () => {
    await db.insert(jobTeam).values({ jobId, userId: people.recruiter.id, teamRole: "viewer" });
    expect((await call(recruiter, "getJob", { params: { id: jobId } })).status).toBe(200);
    expect((await call(recruiter, "getCandidate", { params: { id: candidateId } })).status).toBe(200);
    await db.delete(jobTeam).where(and(eq(jobTeam.jobId, jobId), eq(jobTeam.userId, people.recruiter.id)));
    expect((await call(recruiter, "getJob", { params: { id: jobId } })).status).toBe(404);
  });
});
