/**
 * Import a document in the open format into a PennyATS database, in one transaction.
 *
 * - Idempotent: records whose id already exists are skipped, so importing twice changes nothing.
 * - Candidates are matched by email like the apply form: a known email reuses that candidate.
 * - People missing from the instance are created deactivated, with no password, so authorship
 *   and interview panels survive. An admin can reactivate them and send a reset link.
 * - A job whose slug is taken by another job gets "-imported" added to its slug.
 */
import { inArray } from "drizzle-orm";
import {
  activity,
  applicationNotes,
  applications,
  candidates,
  interviewInterviewers,
  interviews,
  jobTeam,
  jobs,
  notes,
  scorecards,
  stages,
  users,
  type Db,
} from "@pennyats/db";
import { ExportDocument } from "./format";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ImportSummary = {
  created: Record<"people" | "jobs" | "stages" | "candidates" | "applications" | "events" | "interviews" | "scorecards" | "notes", number>;
  merged_candidates: number;
  skipped_existing: Record<"jobs" | "candidates" | "applications" | "notes", number>;
  renamed_slugs: { from: string; to: string }[];
};

export class ImportError extends Error {}

/** Parse and check a document. Unknown fields are dropped, as the compatibility policy requires. */
export function parseExport(input: unknown): ExportDocument {
  const version = (input as { schema_version?: unknown } | null)?.schema_version;
  if (typeof version !== "string" || !/^1\.\d+\.\d+$/.test(version)) {
    throw new ImportError(`This importer reads schema version 1.x. The file says ${JSON.stringify(version ?? null)}.`);
  }
  const parsed = ExportDocument.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ImportError(`The file doesn't match the PennyATS export schema:\n${issues.join("\n")}`);
  }
  return parsed.data;
}

/** Check that every reference points at something in the file or already in the database. */
function checkReferences(doc: ExportDocument, existing: { jobs: Set<string>; stages: Set<string>; candidates: Set<string>; applications: Set<string> }) {
  const jobIds = new Set([...doc.jobs.map((j) => j.id), ...existing.jobs]);
  const stageIds = new Set([...doc.jobs.flatMap((j) => j.stages.map((s) => s.id)), ...existing.stages]);
  const candidateIds = new Set([...doc.candidates.map((c) => c.id), ...existing.candidates]);
  const appIds = new Set([...doc.applications.map((a) => a.id), ...existing.applications]);
  const interviewIds = new Set(doc.interviews.map((i) => i.id));
  const emails = new Set(doc.people.map((p) => p.email.toLowerCase()));
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok && problems.length < 10) problems.push(message);
  };
  const person = (e: string | null, where: string) => need(e === null || emails.has(e.toLowerCase()), `${where} refers to ${e}, who isn't in people`);

  for (const j of doc.jobs) {
    person(j.hiring_manager_email, `job ${j.id}`);
    person(j.recruiter_email, `job ${j.id}`);
    person(j.created_by_email, `job ${j.id}`);
    j.hiring_team_emails.forEach((e) => person(e, `job ${j.id}`));
  }
  for (const a of doc.applications) {
    need(jobIds.has(a.job_id), `application ${a.id} refers to unknown job ${a.job_id}`);
    need(candidateIds.has(a.candidate_id), `application ${a.id} refers to unknown candidate ${a.candidate_id}`);
    need(a.stage_id === null || stageIds.has(a.stage_id), `application ${a.id} refers to unknown stage ${a.stage_id}`);
    a.events.forEach((e) => person(e.actor_email, `application ${a.id}`));
    a.notes.forEach((n) => person(n.author_email, `application ${a.id}`));
  }
  for (const i of doc.interviews) {
    need(appIds.has(i.application_id), `interview ${i.id} refers to unknown application ${i.application_id}`);
    i.interviewer_emails.forEach((e) => person(e, `interview ${i.id}`));
  }
  for (const s of doc.scorecards) {
    need(appIds.has(s.application_id), `scorecard ${s.id} refers to unknown application ${s.application_id}`);
    need(s.interview_id === null || interviewIds.has(s.interview_id), `scorecard ${s.id} refers to unknown interview ${s.interview_id}`);
    person(s.author_email, `scorecard ${s.id}`);
  }
  for (const n of doc.notes) {
    need(candidateIds.has(n.candidate_id), `note ${n.id} refers to unknown candidate ${n.candidate_id}`);
    person(n.author_email, `note ${n.id}`);
  }
  if (problems.length) throw new ImportError(`The file has broken references:\n${problems.join("\n")}`);
}

const CHUNK = 500;
async function insertChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

async function existingIds(tx: Tx, table: typeof jobs | typeof candidates | typeof applications | typeof notes | typeof stages, ids: string[]) {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await tx.select({ id: table.id }).from(table).where(inArray(table.id, ids.slice(i, i + CHUNK)));
    rows.forEach((r) => found.add(r.id));
  }
  return found;
}

export async function importWorkspace(db: Db, input: unknown): Promise<ImportSummary> {
  const doc = parseExport(input);
  const summary: ImportSummary = {
    created: { people: 0, jobs: 0, stages: 0, candidates: 0, applications: 0, events: 0, interviews: 0, scorecards: 0, notes: 0 },
    merged_candidates: 0,
    skipped_existing: { jobs: 0, candidates: 0, applications: 0, notes: 0 },
    renamed_slugs: [],
  };

  await db.transaction(async (tx) => {
    const has = {
      jobs: await existingIds(tx, jobs, doc.jobs.map((j) => j.id)),
      stages: await existingIds(tx, stages, doc.applications.map((a) => a.stage_id).filter((s): s is string => Boolean(s))),
      candidates: await existingIds(tx, candidates, [...new Set([...doc.candidates.map((c) => c.id), ...doc.applications.map((a) => a.candidate_id)])]),
      applications: await existingIds(tx, applications, [...new Set([...doc.applications.map((a) => a.id), ...doc.scorecards.map((s) => s.application_id)])]),
    };
    checkReferences(doc, {
      jobs: await existingIds(tx, jobs, doc.applications.map((a) => a.job_id)),
      stages: has.stages,
      candidates: has.candidates,
      applications: has.applications,
    });

    /* People, by email. */
    const userRows = await tx.select({ id: users.id, email: users.email }).from(users);
    const userId = new Map(userRows.map((u) => [u.email.toLowerCase(), u.id]));
    const missing = doc.people.filter((p) => !userId.has(p.email.toLowerCase()));
    if (missing.length) {
      const created = await tx
        .insert(users)
        .values(missing.map((p) => ({ email: p.email.toLowerCase(), name: p.name, role: p.role, active: false, passwordHash: null })))
        .returning({ id: users.id, email: users.email });
      created.forEach((u) => userId.set(u.email.toLowerCase(), u.id));
      summary.created.people = created.length;
    }
    const uid = (email: string | null) => (email ? (userId.get(email.toLowerCase()) ?? null) : null);

    /* Jobs, stages, hiring teams. */
    const newJobs = doc.jobs.filter((j) => !has.jobs.has(j.id));
    summary.skipped_existing.jobs = doc.jobs.length - newJobs.length;
    const takenSlugs = new Set((await tx.select({ slug: jobs.slug }).from(jobs)).map((r) => r.slug));
    for (const j of newJobs) {
      let slug = j.slug;
      if (takenSlugs.has(slug)) {
        let n = 1;
        do slug = `${j.slug}-imported${n === 1 ? "" : `-${n}`}`, n++;
        while (takenSlugs.has(slug));
        summary.renamed_slugs.push({ from: j.slug, to: slug });
      }
      takenSlugs.add(slug);
      await tx.insert(jobs).values({
        id: j.id,
        slug,
        title: j.title,
        status: j.status,
        department: j.department,
        team: j.team,
        location: j.location,
        region: j.region,
        headcount: j.headcount,
        description: j.description,
        employmentType: j.employment_type,
        workplaceType: j.workplace_type,
        requisitionId: j.requisition_id,
        compCurrency: j.compensation.currency,
        compPeriod: j.compensation.period,
        compMin: j.compensation.min,
        compMid: j.compensation.mid,
        compMax: j.compensation.max,
        compPublic: j.compensation.public,
        equityNote: j.equity_note,
        targetStartDate: j.target_start_date,
        priority: j.priority,
        confidential: j.confidential,
        internalNotes: j.internal_notes,
        scorecardAttributes: j.scorecard_attributes,
        hiringManagerId: uid(j.hiring_manager_email),
        recruiterId: uid(j.recruiter_email),
        createdBy: uid(j.created_by_email),
        createdAt: new Date(j.created_at),
        updatedAt: new Date(j.updated_at),
      });
      if (j.stages.length) await tx.insert(stages).values(j.stages.map((s) => ({ id: s.id, jobId: j.id, name: s.name, position: s.position })));
      const team = j.hiring_team_emails.map(uid).filter((id): id is string => Boolean(id));
      if (team.length) await tx.insert(jobTeam).values(team.map((userId) => ({ jobId: j.id, userId }))).onConflictDoNothing();
      summary.created.jobs++;
      summary.created.stages += j.stages.length;
    }

    /* Candidates: same id is the same record; a known email reuses that candidate. */
    const candidateMap = new Map<string, string>();
    const byEmail = new Map<string, string>();
    const emailsInFile = doc.candidates.map((c) => c.email?.toLowerCase()).filter((e): e is string => Boolean(e));
    for (let i = 0; i < emailsInFile.length; i += CHUNK) {
      const rows = await tx
        .select({ id: candidates.id, email: candidates.email })
        .from(candidates)
        .where(inArray(candidates.email, emailsInFile.slice(i, i + CHUNK)));
      rows.forEach((r) => r.email && byEmail.set(r.email, r.id));
    }
    const newCandidates = [];
    for (const c of doc.candidates) {
      const email = c.email?.toLowerCase() ?? null;
      if (has.candidates.has(c.id)) {
        candidateMap.set(c.id, c.id);
        summary.skipped_existing.candidates++;
      } else if (email && byEmail.has(email)) {
        candidateMap.set(c.id, byEmail.get(email)!);
        summary.merged_candidates++;
      } else {
        candidateMap.set(c.id, c.id);
        if (email) byEmail.set(email, c.id);
        newCandidates.push(c);
      }
    }
    await insertChunks(newCandidates, (chunk) =>
      tx.insert(candidates).values(
        chunk.map((c) => ({
          id: c.id,
          fullName: c.full_name,
          email: c.email?.toLowerCase() ?? null,
          phone: c.phone,
          linkedinUrl: c.linkedin_url,
          location: c.location,
          source: c.source,
          tags: c.tags,
          resumeName: c.resume_name,
          resumeText: c.resume_text,
          consentedAt: c.consented_at ? new Date(c.consented_at) : null,
          createdAt: new Date(c.created_at),
        })),
      ),
    );
    summary.created.candidates = newCandidates.length;
    const cid = (id: string) => candidateMap.get(id) ?? id;

    /* Applications. One per candidate and job, so a merged candidate's duplicate is skipped. */
    const inserted = new Set<string>();
    const pending = doc.applications.filter((a) => !has.applications.has(a.id));
    summary.skipped_existing.applications = doc.applications.length - pending.length;
    await insertChunks(pending, async (chunk) => {
      const rows = await tx
        .insert(applications)
        .values(
          chunk.map((a) => ({
            id: a.id,
            candidateId: cid(a.candidate_id),
            jobId: a.job_id,
            stageId: a.stage_id,
            status: a.status,
            rejectionReason: a.rejection_reason,
            appliedAt: new Date(a.applied_at),
            stageChangedAt: new Date(a.stage_changed_at),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: applications.id });
      rows.forEach((r) => inserted.add(r.id));
    });
    summary.created.applications = inserted.size;
    summary.skipped_existing.applications += pending.length - inserted.size;
    const fresh = doc.applications.filter((a) => inserted.has(a.id));

    const eventRows = fresh.flatMap((a) =>
      a.events.map((e) => ({ applicationId: a.id, actorId: uid(e.actor_email), type: e.type, data: e.data, createdAt: new Date(e.at) })),
    );
    await insertChunks(eventRows, (chunk) => tx.insert(activity).values(chunk));
    summary.created.events = eventRows.length;
    const noteRows = fresh.flatMap((a) =>
      a.notes.map((n) => ({
        applicationId: a.id,
        kind: n.kind,
        body: n.body,
        authorId: uid(n.author_email),
        createdAt: new Date(n.created_at),
        updatedAt: new Date(n.updated_at),
      })),
    );
    await insertChunks(noteRows, (chunk) => tx.insert(applicationNotes).values(chunk).onConflictDoNothing());

    /* Interviews and scorecards on applications created by this import. */
    const freshInterviews = doc.interviews.filter((i) => inserted.has(i.application_id));
    await insertChunks(freshInterviews, (chunk) =>
      tx.insert(interviews).values(
        chunk.map((i) => ({
          id: i.id,
          applicationId: i.application_id,
          stageId: i.stage_id,
          name: i.name,
          stageName: i.stage_name,
          durationMinutes: i.duration_minutes,
          attributes: i.attributes,
          instructions: i.instructions,
          scheduledAt: i.scheduled_at ? new Date(i.scheduled_at) : null,
          scheduledTimeZone: i.scheduled_time_zone,
          meetingLocation: i.meeting_location,
          completedAt: i.completed_at ? new Date(i.completed_at) : null,
          cancelledAt: i.cancelled_at ? new Date(i.cancelled_at) : null,
          createdAt: new Date(i.created_at),
        })),
      ),
    );
    summary.created.interviews = freshInterviews.length;
    const panel = freshInterviews.flatMap((i) =>
      i.interviewer_emails.map(uid).filter((id): id is string => Boolean(id)).map((userId) => ({ interviewId: i.id, userId })),
    );
    await insertChunks(panel, (chunk) => tx.insert(interviewInterviewers).values(chunk).onConflictDoNothing());

    const freshCards = doc.scorecards.filter((s) => inserted.has(s.application_id));
    await insertChunks(freshCards, (chunk) =>
      tx
        .insert(scorecards)
        .values(
          chunk.map((s) => ({
            id: s.id,
            applicationId: s.application_id,
            interviewId: s.interview_id,
            authorId: uid(s.author_email)!,
            stageName: s.stage_name,
            recommendation: s.recommendation,
            ratings: s.ratings,
            summary: s.summary,
            createdAt: new Date(s.created_at),
            updatedAt: new Date(s.updated_at),
          })),
        )
        .onConflictDoNothing(),
    );
    summary.created.scorecards = freshCards.length;

    /* Candidate notes, by id. */
    const knownNotes = await existingIds(tx, notes, doc.notes.map((n) => n.id));
    const freshNotes = doc.notes.filter((n) => !knownNotes.has(n.id));
    summary.skipped_existing.notes = doc.notes.length - freshNotes.length;
    await insertChunks(freshNotes, (chunk) =>
      tx.insert(notes).values(
        chunk.map((n) => ({ id: n.id, candidateId: cid(n.candidate_id), authorId: uid(n.author_email)!, body: n.body, createdAt: new Date(n.created_at) })),
      ),
    );
    summary.created.notes = freshNotes.length;
  });
  return summary;
}
