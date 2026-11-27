/**
 * Row-level security (#119), straight against Postgres as the app's restricted role: each role's
 * flags try cross-job reads and writes and must be denied. Also times the main list queries
 * with and without RLS; the numbers are printed for docs/rls.md.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { applicationNotes, applications, jobs, postgres, scorecards, stages } from "@pennyats/db";
import { expect, test } from "@playwright/test";
import { db, seededUsers } from "./api-helpers";

test.describe.configure({ mode: "serial" });

const appUrl = process.env.APP_DATABASE_URL;
test.skip(!appUrl, "APP_DATABASE_URL is not set; scripts/run-integration.mjs sets it.");

type Settings = { actorId: string | null; flags: string[] };
const app = appUrl ? postgres(appUrl, { max: 2, onnotice: () => {} }) : (null as unknown as postgres.Sql);

/** Run `fn` as the app would: one transaction with the acting user set. */
function as<T>(s: Settings, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return app.begin(async (sql) => {
    await sql`select set_config('pennyats.actor_id', ${s.actorId ?? ""}, true), set_config('pennyats.flags', ${s.flags.join(",")}, true)`;
    return fn(sql);
  }) as Promise<T>;
}

const INTERVIEWER: string[] = [];
const RECRUITER = ["view_all_jobs", "view_all_scorecards", "phone_screen_read"];
const COORDINATOR = ["view_all_jobs", "phone_screen_read"];
const ADMIN = ["view_all_jobs", "view_confidential", "view_all_scorecards", "phone_screen_read"];

let people: Awaited<ReturnType<typeof seededUsers>>;
let theirJob = "";
let otherJob = "";
let theirApp = "";
let otherApp = "";
let otherCandidate = "";
let confidentialJob = "";

test.beforeAll(async () => {
  people = await seededUsers();
  theirJob = people.interviewerJobIds[0];
  const [other] = await db.select({ id: jobs.id }).from(jobs).where(and(notInArray(jobs.id, people.interviewerJobIds), eq(jobs.confidential, false))).limit(1);
  otherJob = other.id;
  // An application on the interviewer's job with other people's scorecards and none of theirs.
  const withCards = await db
    .select({ id: applications.id })
    .from(applications)
    .innerJoin(scorecards, eq(scorecards.applicationId, applications.id))
    .where(and(eq(applications.jobId, theirJob), ne(scorecards.authorId, people.interviewer.id)))
    .limit(20);
  const mine = await db.select({ applicationId: scorecards.applicationId }).from(scorecards).where(eq(scorecards.authorId, people.interviewer.id));
  theirApp = withCards.map((r) => r.id).find((id) => !mine.some((m) => m.applicationId === id)) ?? withCards[0].id;
  const [o] = await db.select({ id: applications.id, candidateId: applications.candidateId }).from(applications).where(eq(applications.jobId, otherJob)).limit(1);
  otherApp = o.id;
  // A candidate who only applied to the other job.
  const onlyOther = await db
    .select({ candidateId: applications.candidateId })
    .from(applications)
    .where(eq(applications.jobId, otherJob))
    .limit(50);
  for (const r of onlyOther) {
    const elsewhere = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.candidateId, r.candidateId), inArray(applications.jobId, people.interviewerJobIds)));
    if (!elsewhere.length) {
      otherCandidate = r.candidateId;
      break;
    }
  }
  // A phone screen note on the other job, for the read rule.
  await db.delete(applicationNotes).where(and(eq(applicationNotes.applicationId, otherApp), eq(applicationNotes.kind, "phone_screen")));
  await db.insert(applicationNotes).values({ applicationId: otherApp, kind: "phone_screen", body: "RLS phone screen" });
  const [conf] = await db
    .insert(jobs)
    .values({ title: `RLS confidential ${randomUUID().slice(0, 6)}`, slug: `rls-confidential-${randomUUID()}`, confidential: true, status: "open" })
    .returning({ id: jobs.id });
  confidentialJob = conf.id;
  await db.insert(stages).values({ jobId: confidentialJob, name: "Applied", position: 0 });
});

test.afterAll(async () => {
  await db.delete(jobs).where(eq(jobs.id, confidentialJob));
  await app?.end();
});

test("with no acting user and no system flag, every protected table is empty", async () => {
  const rows = await as({ actorId: null, flags: [] }, (sql) => sql`
    select (select count(*) from candidates)::int as candidates, (select count(*) from applications)::int as applications,
           (select count(*) from scorecards)::int as scorecards, (select count(*) from jobs)::int as jobs`);
  expect(rows[0]).toEqual({ candidates: 0, applications: 0, scorecards: 0, jobs: 0 });
  const system = await as({ actorId: null, flags: ["system"] }, (sql) => sql`select count(*)::int as n from applications`);
  expect(system[0].n).toBeGreaterThan(0);
});

test("interviewer: only their jobs, for reads and writes", async () => {
  const me = { actorId: people.interviewer.id, flags: INTERVIEWER };
  await as(me, async (sql) => {
    expect((await sql`select count(*)::int as n from applications where job_id = ${otherJob}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from applications where job_id = ${theirJob}`)[0].n).toBeGreaterThan(0);
    expect((await sql`select count(*)::int as n from jobs where id = ${otherJob}`)[0].n).toBe(0);
    if (otherCandidate) expect((await sql`select count(*)::int as n from candidates where id = ${otherCandidate}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from interviews i join applications a on a.id = i.application_id where a.job_id = ${otherJob}`)[0].n).toBe(0);
    // Writes to another job's rows touch nothing.
    expect((await sql`update applications set rejection_reason = 'rls' where id = ${otherApp}`).count).toBe(0);
    expect((await sql`delete from applications where id = ${otherApp}`).count).toBe(0);
    // Phone screen notes are not theirs to read.
    expect((await sql`select count(*)::int as n from application_notes`)[0].n).toBe(0);
  });
  // Inserts into another job, or as someone else, are rejected outright.
  await expect(as(me, (sql) => sql`insert into notes (candidate_id, body, author_id) values (${otherCandidate || randomUUID()}, 'x', ${people.interviewer.id})`)).rejects.toThrow(/row-level security|foreign key/);
  await expect(as(me, (sql) => sql`insert into scorecards (application_id, author_id, stage_name, recommendation) values (${otherApp}, ${people.interviewer.id}, 'x', 'yes')`)).rejects.toThrow(/row-level security/);
  await expect(as(me, (sql) => sql`insert into scorecards (application_id, author_id, stage_name, recommendation) values (${theirApp}, ${people.recruiter.id}, 'x', 'yes')`)).rejects.toThrow(/row-level security/);
});

test("blind review: other people's scorecards stay hidden until you submit your own", async () => {
  const me = { actorId: people.interviewer.id, flags: INTERVIEWER };
  const [{ mine }] = await db.select({ mine: scorecards.id }).from(scorecards).where(and(eq(scorecards.applicationId, theirApp), eq(scorecards.authorId, people.interviewer.id))).then((r) => (r.length ? r : [{ mine: null }]));
  test.skip(mine !== null, "The interviewer already reviewed this application in the seed.");
  const others = await as(me, (sql) => sql`select count(*)::int as n from scorecards where application_id = ${theirApp} and author_id <> ${people.interviewer.id}`);
  expect(others[0].n).toBe(0);
  const facts = await as({ ...me, flags: ["scorecard_facts"] }, (sql) => sql`select count(*)::int as n from scorecards where application_id = ${theirApp}`);
  expect(facts[0].n).toBeGreaterThan(0);
  // After submitting their own, the rest appear (inside one transaction, then rolled back).
  await app
    .begin(async (sql) => {
      await sql`select set_config('pennyats.actor_id', ${people.interviewer.id}, true), set_config('pennyats.flags', '', true)`;
      await sql`insert into scorecards (application_id, author_id, stage_name, recommendation) values (${theirApp}, ${people.interviewer.id}, 'RLS check', 'yes')`;
      const after = await sql`select count(*)::int as n from scorecards where application_id = ${theirApp} and author_id <> ${people.interviewer.id}`;
      expect(after[0].n).toBeGreaterThan(0);
      throw new Error("rollback");
    })
    .catch((e: Error) => expect(e.message).toBe("rollback"));
});

test("recruiter and coordinator: every job except confidential ones; coordinator sees no scorecard content", async () => {
  const recruiter = { actorId: people.recruiter.id, flags: RECRUITER };
  await as(recruiter, async (sql) => {
    expect((await sql`select count(*)::int as n from applications where job_id = ${otherJob}`)[0].n).toBeGreaterThan(0);
    expect((await sql`select count(*)::int as n from jobs where id = ${confidentialJob}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from stages where job_id = ${confidentialJob}`)[0].n).toBe(0);
    expect((await sql`update jobs set title = 'rls' where id = ${confidentialJob}`).count).toBe(0);
  });
  const admin = { actorId: people.admin.id, flags: ADMIN };
  expect((await as(admin, (sql) => sql`select count(*)::int as n from jobs where id = ${confidentialJob}`))[0].n).toBe(1);
  const coordinator = { actorId: randomUUID(), flags: COORDINATOR };
  await as(coordinator, async (sql) => {
    expect((await sql`select count(*)::int as n from applications where job_id = ${otherJob}`)[0].n).toBeGreaterThan(0);
    expect((await sql`select count(*)::int as n from scorecards`)[0].n).toBe(0);
    const notes = (await sql`select count(*)::int as n from application_notes where application_id = ${otherApp}`)[0].n;
    expect(notes).toBeGreaterThan(0);
  });
});

test("performance: main list queries with and without RLS", async () => {
  const owner = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const queries: Record<string, string> = {
    "candidates list (50 newest with applications)": `select c.id, c.full_name from candidates c where exists (select 1 from applications a where a.candidate_id = c.id) order by c.created_at desc limit 50`,
    "candidate count": `select count(*) from candidates`,
    "job pipeline (applications on one job)": `select a.id from applications a where a.job_id = '${theirJob}'`,
    "jobs list with active counts": `select j.id, count(a.id) from jobs j left join applications a on a.job_id = j.id and a.status = 'active' group by j.id`,
  };
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const time = async (run: () => Promise<unknown>) => {
    const out: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      await run();
      out.push(performance.now() - t);
    }
    return Math.round(median(out) * 10) / 10;
  };
  const results: Record<string, { owner_ms: number; recruiter_ms: number; interviewer_ms: number }> = {};
  for (const [name, q] of Object.entries(queries)) {
    results[name] = {
      owner_ms: await time(() => owner.unsafe(q)),
      recruiter_ms: await time(() => as({ actorId: people.recruiter.id, flags: RECRUITER }, (sql) => sql.unsafe(q))),
      interviewer_ms: await time(() => as({ actorId: people.interviewer.id, flags: INTERVIEWER }, (sql) => sql.unsafe(q))),
    };
  }
  await owner.end();
  console.log(`RLS performance (median of 7, ms, seeded data):\n${JSON.stringify(results, null, 2)}`);
  for (const r of Object.values(results)) expect(r.recruiter_ms).toBeLessThan(5000);
});
