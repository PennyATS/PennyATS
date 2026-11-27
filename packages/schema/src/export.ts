/** Build a whole-workspace export document from the database. Admin-only callers. */
import { asc, eq } from "drizzle-orm";
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
  roles,
  scorecards,
  stages,
  users,
  type Db,
} from "@pennyats/db";
import { SCHEMA_VERSION, type ExportDocument } from "./format";

/** The 1.0 role with no more access than a role preset: admin and recruiter map to themselves, the rest to interviewer. */
export function legacyRole(key: string): "admin" | "recruiter" | "interviewer" {
  if (key === "admin") return "admin";
  if (key === "recruiter" || key === "head_of_talent" || key === "ta_manager") return "recruiter";
  return "interviewer";
}

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function group<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/**
 * Everything in the open format. Deterministic order (by id, events oldest first), so two exports
 * of the same data are identical apart from `exported_at`.
 */
export async function exportWorkspace(db: Db, now: Date = new Date()): Promise<ExportDocument> {
  const [userRows, jobRows, stageRows, teamRows, candidateRows, appRows, events, appNotes, interviewRows, people, cardRows, noteRows] =
    await Promise.all([
      db.select({ id: users.id, email: users.email, name: users.name, roleKey: roles.key }).from(users).innerJoin(roles, eq(roles.id, users.roleId)),
      db.select().from(jobs),
      db.select().from(stages).orderBy(asc(stages.position), asc(stages.id)),
      db.select().from(jobTeam),
      db.select().from(candidates),
      db.select().from(applications),
      db.select().from(activity),
      db.select().from(applicationNotes).orderBy(asc(applicationNotes.kind)),
      db.select().from(interviews),
      db.select().from(interviewInterviewers),
      db.select().from(scorecards),
      db.select().from(notes),
    ]);

  const emailOf = new Map(userRows.map((u) => [u.id, u.email.toLowerCase()]));
  const referenced = new Set<string>();
  const email = (id: string | null): string | null => {
    if (!id) return null;
    const e = emailOf.get(id) ?? null;
    if (e) referenced.add(e);
    return e;
  };
  const emails = (ids: string[]) => [...new Set(ids.map((id) => email(id)).filter((e): e is string => Boolean(e)))].sort();

  const stagesByJob = group(stageRows, (s) => s.jobId);
  const teamByJob = group(teamRows, (t) => t.jobId);
  const eventsByApp = group(events, (e) => e.applicationId);
  const notesByApp = group(appNotes, (n) => n.applicationId);
  const peopleByInterview = group(people, (p) => p.interviewId);

  const doc: ExportDocument = {
    format: "pennyats-export",
    schema_version: SCHEMA_VERSION,
    exported_at: iso(now),
    people: [],
    jobs: [...jobRows].sort(byId).map((j) => ({
      id: j.id,
      slug: j.slug,
      title: j.title,
      status: j.status,
      department: j.department,
      team: j.team,
      location: j.location,
      region: j.region,
      headcount: j.headcount,
      description: j.description,
      employment_type: j.employmentType,
      workplace_type: j.workplaceType,
      requisition_id: j.requisitionId,
      compensation: { currency: j.compCurrency, period: j.compPeriod, min: j.compMin, mid: j.compMid, max: j.compMax, public: j.compPublic },
      equity_note: j.equityNote,
      target_start_date: j.targetStartDate,
      priority: j.priority,
      confidential: j.confidential,
      internal_notes: j.internalNotes,
      scorecard_attributes: j.scorecardAttributes,
      hiring_manager_email: email(j.hiringManagerId),
      recruiter_email: email(j.recruiterId),
      hiring_team_emails: emails((teamByJob.get(j.id) ?? []).map((t) => t.userId)),
      hiring_team_roles: Object.fromEntries(
        (teamByJob.get(j.id) ?? [])
          .map((t) => [emailOf.get(t.userId), t.teamRole] as const)
          .filter((pair): pair is readonly [string, typeof pair[1]] => Boolean(pair[0]))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      created_by_email: email(j.createdBy),
      stages: (stagesByJob.get(j.id) ?? []).map((s) => ({ id: s.id, name: s.name, position: s.position })),
      created_at: iso(j.createdAt),
      updated_at: iso(j.updatedAt),
    })),
    candidates: [...candidateRows].sort(byId).map((c) => ({
      id: c.id,
      full_name: c.fullName,
      email: c.email,
      phone: c.phone,
      linkedin_url: c.linkedinUrl,
      location: c.location,
      source: c.source,
      tags: c.tags,
      resume_name: c.resumeName,
      resume_text: c.resumeText,
      consented_at: isoOrNull(c.consentedAt),
      created_at: iso(c.createdAt),
    })),
    applications: [...appRows].sort(byId).map((a) => ({
      id: a.id,
      candidate_id: a.candidateId,
      job_id: a.jobId,
      stage_id: a.stageId,
      status: a.status,
      rejection_reason: a.rejectionReason,
      applied_at: iso(a.appliedAt),
      stage_changed_at: iso(a.stageChangedAt),
      // Events in one transaction share a timestamp, so ties are ordered by content, not by row id.
      events: (eventsByApp.get(a.id) ?? [])
        .map((e) => ({ type: e.type, at: iso(e.createdAt), actor_email: email(e.actorId), data: e.data }))
        .sort((x, y) => x.at.localeCompare(y.at) || x.type.localeCompare(y.type) || JSON.stringify(x.data).localeCompare(JSON.stringify(y.data))),
      notes: (notesByApp.get(a.id) ?? []).map((n) => ({
        kind: n.kind,
        body: n.body,
        author_email: email(n.authorId),
        created_at: iso(n.createdAt),
        updated_at: iso(n.updatedAt),
      })),
    })),
    interviews: [...interviewRows].sort(byId).map((i) => ({
      id: i.id,
      application_id: i.applicationId,
      stage_id: i.stageId,
      name: i.name,
      stage_name: i.stageName,
      duration_minutes: i.durationMinutes,
      attributes: i.attributes,
      instructions: i.instructions,
      scheduled_at: isoOrNull(i.scheduledAt),
      scheduled_time_zone: i.scheduledTimeZone,
      meeting_location: i.meetingLocation,
      interviewer_emails: emails((peopleByInterview.get(i.id) ?? []).map((p) => p.userId)),
      completed_at: isoOrNull(i.completedAt),
      cancelled_at: isoOrNull(i.cancelledAt),
      created_at: iso(i.createdAt),
    })),
    scorecards: [...cardRows].sort(byId).map((s) => ({
      id: s.id,
      application_id: s.applicationId,
      interview_id: s.interviewId,
      author_email: email(s.authorId)!,
      stage_name: s.stageName,
      recommendation: s.recommendation,
      ratings: s.ratings,
      summary: s.summary,
      created_at: iso(s.createdAt),
      updated_at: iso(s.updatedAt),
    })),
    notes: [...noteRows].sort(byId).map((n) => ({
      id: n.id,
      candidate_id: n.candidateId,
      author_email: email(n.authorId)!,
      body: n.body,
      created_at: iso(n.createdAt),
    })),
  };

  doc.people = userRows
    .filter((u) => referenced.has(u.email.toLowerCase()))
    .map((u) => ({ email: u.email.toLowerCase(), name: u.name, role: legacyRole(u.roleKey), role_key: u.roleKey }))
    .sort((a, b) => a.email.localeCompare(b.email));
  return doc;
}
