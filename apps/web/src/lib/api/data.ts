/**
 * Queries and serializers for the public API. Every query applies the same visibility rules
 * as the app (visibleJobIds, canSeeJob, canSeeCandidate, the blind scorecard rule).
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import {
  applications,
  candidates,
  emailTemplates,
  interviewInterviewers,
  interviews,
  jobs,
  notes,
  scorecards,
  stages,
  users,
} from "@pennyats/db";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { SessionUser } from "../auth";
import { db } from "../db";
import { canSeeCandidate, canSeeJob, visibleJobIds } from "../hiring";
import { interviewStatus } from "../interviews";
import { canManageHiring } from "../permissions";
import { canSeeOthersScorecards } from "../scorecards";
import { ApiError, notFound } from "./handler";

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/* ---------- Cursor pagination ---------- */

/** Opaque cursor over (timestamp, id), newest first. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw 0;
    return { at, id };
  } catch {
    throw new ApiError("invalid_request", "Invalid cursor. Pass the `next_cursor` value from the previous page.");
  }
}

/** WHERE (time, id) < cursor, for a newest-first keyset page. */
/*
 * Postgres keeps microseconds, but a cursor carries JavaScript's milliseconds. Paging compares and
 * orders on the time truncated to milliseconds, or rows that share a timestamp (everything written
 * in one transaction, like a seed or an import) could be skipped between pages.
 */
const ms = (timeCol: SQL | AnyPgColumn) => sql`date_trunc('milliseconds', ${timeCol})`;

export function before(timeCol: SQL | AnyPgColumn, idCol: AnyPgColumn, cursor: { at: string; id: string } | null) {
  return cursor ? sql`(${ms(timeCol)}, ${idCol}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined;
}

/** ORDER BY for a newest-first keyset page; pair with `before`. */
export function newestFirst(timeCol: AnyPgColumn, idCol: AnyPgColumn) {
  return [desc(ms(timeCol)), desc(idCol)] as const;
}

/** Trim the extra row fetched to detect another page and build next_cursor. */
export function pageOf<T>(rows: T[], limit: number, keyOf: (row: T) => { at: Date; id: string }) {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, next_cursor: more && last ? encodeCursor(keyOf(last).at, keyOf(last).id) : null };
}

/* ---------- Jobs ---------- */

type JobRow = typeof jobs.$inferSelect;
type StageRow = typeof stages.$inferSelect;

export const serializeStage = (s: StageRow) => ({ id: s.id, job_id: s.jobId, name: s.name, position: s.position });

export function serializeJob(j: JobRow, jobStages: StageRow[]) {
  return {
    id: j.id,
    slug: j.slug,
    title: j.title,
    status: j.status,
    department: j.department,
    team: j.team,
    location: j.location,
    region: j.region,
    headcount: j.headcount,
    employment_type: j.employmentType,
    workplace_type: j.workplaceType,
    description: j.description,
    confidential: j.confidential,
    hiring_manager_id: j.hiringManagerId,
    recruiter_id: j.recruiterId,
    stages: jobStages.filter((s) => s.jobId === j.id).sort((a, b) => a.position - b.position).map(serializeStage),
    created_at: iso(j.createdAt),
    updated_at: iso(j.updatedAt),
  };
}

export async function stagesFor(jobIds: string[]): Promise<StageRow[]> {
  if (jobIds.length === 0) return [];
  return db().select().from(stages).where(inArray(stages.jobId, jobIds)).orderBy(asc(stages.position));
}

export async function loadJob(user: SessionUser, jobId: string) {
  if (!(await canSeeJob(user, jobId))) throw notFound("Job");
  const [job] = await db().select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw notFound("Job");
  return serializeJob(job, await stagesFor([job.id]));
}

/* ---------- Candidates and applications ---------- */

type CandidateRow = typeof candidates.$inferSelect;

export function serializeCandidate(c: CandidateRow) {
  return {
    id: c.id,
    full_name: c.fullName,
    email: c.email,
    phone: c.phone,
    linkedin_url: c.linkedinUrl,
    location: c.location,
    source: c.source,
    tags: c.tags,
    has_resume: Boolean(c.resumeKey),
    consented_at: isoOrNull(c.consentedAt),
    created_at: iso(c.createdAt),
  };
}

const applicationColumns = {
  id: applications.id,
  candidateId: applications.candidateId,
  jobId: applications.jobId,
  jobTitle: jobs.title,
  stageId: applications.stageId,
  stageName: stages.name,
  status: applications.status,
  rejectionReason: applications.rejectionReason,
  appliedAt: applications.appliedAt,
  stageChangedAt: applications.stageChangedAt,
};

type ApplicationRow = {
  id: string;
  candidateId: string;
  jobId: string;
  jobTitle: string;
  stageId: string | null;
  stageName: string | null;
  status: "active" | "hired" | "rejected" | "withdrawn";
  rejectionReason: string | null;
  appliedAt: Date;
  stageChangedAt: Date;
};

export function serializeApplication(a: ApplicationRow) {
  return {
    id: a.id,
    candidate_id: a.candidateId,
    job_id: a.jobId,
    job_title: a.jobTitle,
    stage_id: a.stageId,
    stage_name: a.stageName,
    status: a.status,
    rejection_reason: a.rejectionReason,
    applied_at: iso(a.appliedAt),
    stage_changed_at: iso(a.stageChangedAt),
  };
}

function applicationQuery() {
  return db()
    .select(applicationColumns)
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(stages, eq(stages.id, applications.stageId));
}

/** Applications matching the filters, limited to visible jobs, newest first. */
export async function listApplications(
  user: SessionUser,
  filters: { job_id?: string; candidate_id?: string; stage_id?: string; status?: ApplicationRow["status"]; limit: number; cursor?: string },
) {
  const ids = await visibleJobIds(user);
  if (ids !== null && ids.length === 0) return { data: [], next_cursor: null };
  const cursor = decodeCursor(filters.cursor);
  const rows = await applicationQuery()
    .where(
      and(
        ids ? inArray(applications.jobId, ids) : undefined,
        filters.job_id ? eq(applications.jobId, filters.job_id) : undefined,
        filters.candidate_id ? eq(applications.candidateId, filters.candidate_id) : undefined,
        filters.stage_id ? eq(applications.stageId, filters.stage_id) : undefined,
        filters.status ? eq(applications.status, filters.status) : undefined,
        before(sql`${applications.appliedAt}`, applications.id, cursor),
      ),
    )
    .orderBy(...newestFirst(applications.appliedAt, applications.id))
    .limit(filters.limit + 1);
  const page = pageOf(rows, filters.limit, (r) => ({ at: r.appliedAt, id: r.id }));
  return { data: page.data.map(serializeApplication), next_cursor: page.next_cursor };
}

/** One application the user may see, serialized. */
export async function loadApplication(user: SessionUser, applicationId: string) {
  const [row] = await applicationQuery().where(eq(applications.id, applicationId));
  if (!row || !(await canSeeJob(user, row.jobId))) throw notFound("Application");
  return serializeApplication(row);
}

export async function loadCandidate(user: SessionUser, candidateId: string) {
  if (!(await canSeeCandidate(user, candidateId))) throw notFound("Candidate");
  const [row] = await db().select().from(candidates).where(eq(candidates.id, candidateId));
  if (!row) throw notFound("Candidate");
  const ids = await visibleJobIds(user);
  const apps = await applicationQuery()
    .where(and(eq(applications.candidateId, candidateId), ids ? inArray(applications.jobId, ids) : undefined))
    .orderBy(desc(applications.appliedAt));
  return { ...serializeCandidate(row), applications: apps.map(serializeApplication) };
}

/* ---------- Notes ---------- */

export async function listNotes(user: SessionUser, candidateId: string, limit: number, cursorText?: string) {
  if (!(await canSeeCandidate(user, candidateId))) throw notFound("Candidate");
  const cursor = decodeCursor(cursorText);
  const rows = await db()
    .select({ note: notes, author: users.name })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.authorId))
    .where(and(eq(notes.candidateId, candidateId), before(sql`${notes.createdAt}`, notes.id, cursor)))
    .orderBy(...newestFirst(notes.createdAt, notes.id))
    .limit(limit + 1);
  const page = pageOf(rows, limit, (r) => ({ at: r.note.createdAt, id: r.note.id }));
  return { data: page.data.map((r) => serializeNote(r.note, r.author)), next_cursor: page.next_cursor };
}

export function serializeNote(n: typeof notes.$inferSelect, author: string) {
  return { id: n.id, candidate_id: n.candidateId, author_id: n.authorId, author_name: author, body: n.body, created_at: iso(n.createdAt) };
}

/* ---------- Scorecards ---------- */

type ScorecardRow = typeof scorecards.$inferSelect;

export function serializeScorecard(c: ScorecardRow, author: string) {
  return {
    id: c.id,
    application_id: c.applicationId,
    interview_id: c.interviewId,
    author_id: c.authorId,
    author_name: author,
    stage_name: c.stageName,
    recommendation: c.recommendation,
    ratings: c.ratings,
    summary: c.summary,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

/**
 * Scorecards on an application. Interviewers see only their own until they have submitted
 * one, the same rule the candidate page uses (canSeeOthersScorecards).
 */
export async function listScorecards(user: SessionUser, applicationId: string) {
  const [app] = await db().select({ jobId: applications.jobId }).from(applications).where(eq(applications.id, applicationId));
  if (!app || !(await canSeeJob(user, app.jobId))) throw notFound("Application");
  const rows = await db()
    .select({ card: scorecards, author: users.name })
    .from(scorecards)
    .innerJoin(users, eq(users.id, scorecards.authorId))
    .where(eq(scorecards.applicationId, applicationId))
    .orderBy(asc(scorecards.createdAt));
  const mine = rows.filter((r) => r.card.authorId === user.id);
  const showAll = canSeeOthersScorecards({ managesHiring: canManageHiring(user.role), hasSubmitted: mine.length > 0 });
  const visible = showAll ? rows : mine;
  return { data: visible.map((r) => serializeScorecard(r.card, r.author)), hidden_count: rows.length - visible.length };
}

/* ---------- Interviews ---------- */

/** Interviews matching `where`, with job and candidate ids and the derived status. */
async function loadInterviews(where: SQL | undefined, opts: { limit?: number; newestFirst?: boolean } = {}) {
  let query = db()
    .select({ interview: interviews, jobId: applications.jobId, candidateId: applications.candidateId })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .where(where)
    .orderBy(...(opts.newestFirst ? newestFirst(interviews.createdAt, interviews.id) : [asc(interviews.createdAt), asc(interviews.id)]))
    .$dynamic();
  if (opts.limit) query = query.limit(opts.limit);
  const rows = await query;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.interview.id);
  const [people, submitted] = await Promise.all([
    db().select().from(interviewInterviewers).where(inArray(interviewInterviewers.interviewId, ids)),
    db()
      .select({ interviewId: scorecards.interviewId, authorId: scorecards.authorId })
      .from(scorecards)
      .where(inArray(scorecards.interviewId, ids)),
  ]);
  return rows.map(({ interview: i, jobId, candidateId }) => {
    const interviewerIds = people.filter((p) => p.interviewId === i.id).map((p) => p.userId);
    const status = interviewStatus({
      scheduledAt: i.scheduledAt,
      completedAt: i.completedAt,
      cancelledAt: i.cancelledAt,
      interviewerIds,
      submittedBy: submitted.filter((s) => s.interviewId === i.id).map((s) => s.authorId),
    });
    return {
      id: i.id,
      application_id: i.applicationId,
      candidate_id: candidateId,
      job_id: jobId,
      name: i.name,
      stage_name: i.stageName,
      duration_minutes: i.durationMinutes,
      status,
      scheduled_at: isoOrNull(i.scheduledAt),
      meeting_location: i.meetingLocation,
      interviewer_ids: interviewerIds,
      completed_at: isoOrNull(i.completedAt),
      cancelled_at: isoOrNull(i.cancelledAt),
      created_at: iso(i.createdAt),
    };
  });
}

/** Interviews on one application (the caller has checked access), oldest first. */
export async function listInterviews(applicationId: string, onlyId?: string) {
  return loadInterviews(and(eq(interviews.applicationId, applicationId), onlyId ? eq(interviews.id, onlyId) : undefined));
}

/** One interview the user may see, or a 404. */
export async function loadInterview(user: SessionUser, interviewId: string) {
  const [row] = await loadInterviews(eq(interviews.id, interviewId));
  if (!row || !(await canSeeJob(user, row.job_id))) throw notFound("Interview");
  return row;
}

/** Interviews across visible jobs, newest first, filtered by job, application, or derived status. */
export async function queryInterviews(
  user: SessionUser,
  filters: { job_id?: string; application_id?: string; status?: string; limit: number; cursor?: string },
) {
  const ids = await visibleJobIds(user);
  if (ids !== null && ids.length === 0) return { data: [], next_cursor: null };
  const cursor = decodeCursor(filters.cursor);
  // Narrow in SQL where the status allows it; the exact derived status is applied after.
  const prefilter =
    filters.status === "cancelled"
      ? isNotNull(interviews.cancelledAt)
      : filters.status === "to_schedule"
        ? and(isNull(interviews.cancelledAt), isNull(interviews.completedAt), isNull(interviews.scheduledAt))
        : filters.status
          ? isNull(interviews.cancelledAt)
          : undefined;
  const rows = await loadInterviews(
    and(
      ids ? inArray(applications.jobId, ids) : undefined,
      filters.job_id ? eq(applications.jobId, filters.job_id) : undefined,
      filters.application_id ? eq(interviews.applicationId, filters.application_id) : undefined,
      prefilter,
      before(sql`${interviews.createdAt}`, interviews.id, cursor),
    ),
    { limit: filters.limit + 1, newestFirst: true },
  );
  const page = pageOf(rows, filters.limit, (r) => ({ at: new Date(r.created_at), id: r.id }));
  return {
    data: filters.status ? page.data.filter((r) => r.status === filters.status) : page.data,
    next_cursor: page.next_cursor,
  };
}

/* ---------- Templates ---------- */

export async function listTemplates() {
  const rows = await db().select().from(emailTemplates).orderBy(asc(emailTemplates.name));
  return rows.map((t) => ({ id: t.id, name: t.name, subject: t.subject, folder_id: t.folderId, updated_at: iso(t.updatedAt) }));
}
