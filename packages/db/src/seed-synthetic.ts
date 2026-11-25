import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { generate, type Stage } from "synthetic-recruiting";
import {
  activity,
  applications,
  candidates,
  interviewInterviewers,
  interviews,
  interviewTemplateInterviewers,
  interviewTemplates,
  jobs,
  jobTeam,
  scorecards,
  stages,
  users,
} from "./schema";
import type { Db } from "./index";

/**
 * Demo data from synthetic-recruiting (https://github.com/Allen55/synthetic-recruiting):
 * a reproducible software engineering funnel of invented people at invented companies.
 * Same options, same data. Dates are shifted so the funnel ends today, which keeps the
 * reports' "last 90 days" view and the pipeline board populated whenever you seed.
 */
const OPTIONS = {
  preset: "software_engineering",
  seed: 42,
  applications: 1500,
  startDate: "2025-06-01",
  months: 9,
  // No quiet tail after the last application, so recent applicants are still in flight.
  tailDays: 0,
};

const STAGE_NAMES: Record<Stage, string> = {
  applied: "Applied",
  recruiter_screen: "Recruiter screen",
  hiring_manager_screen: "Hiring manager screen",
  technical_interview: "Technical interview",
  onsite: "Onsite",
  offer: "Offer",
};
const STAGE_ORDER = Object.keys(STAGE_NAMES) as Stage[];

const JOB_ATTRIBUTES = ["Role skills", "Problem solving", "Communication", "Ownership"];

/** The interview plan every synthetic job gets, by stage. */
const PLAN: Partial<Record<Stage, { name: string; minutes: number; attributes: string[] }>> = {
  recruiter_screen: { name: "Recruiter call", minutes: 30, attributes: ["Communication", "Ownership"] },
  hiring_manager_screen: { name: "Hiring manager interview", minutes: 45, attributes: [] },
  technical_interview: { name: "Technical interview", minutes: 60, attributes: ["Role skills", "Problem solving"] },
  onsite: { name: "Onsite panel", minutes: 180, attributes: [] },
};

const SOURCES: Record<string, string> = {
  referral: "Referral",
  linkedin: "LinkedIn",
  job_board: "Job board",
  career_site: "Careers page",
  agency: "Agency",
  university: "University",
};

// Matches the standard list in apps/web/src/lib/candidate-review.ts.
const REJECTION_REASONS: Record<Stage, string[]> = {
  applied: ["Does not meet minimum qualifications", "Not enough relevant experience", "Work authorization or eligibility", "Location or relocation mismatch", "Potentially fraudulent application"],
  recruiter_screen: ["Compensation mismatch", "Not enough relevant experience", "Communication", "Unresponsive"],
  hiring_manager_screen: ["Not enough relevant experience", "Technical skills gap", "Overqualified"],
  technical_interview: ["Did not pass assessment", "Technical skills gap"],
  onsite: ["Technical skills gap", "Values or team alignment", "Hired another candidate"],
  offer: ["Accepted another offer", "Compensation mismatch"],
};

/** Synthetic hiring team. Names are invented; emails use example.com. */
const RECRUITER = { name: "Morgan Avery", email: "recruiter@example.com" };
const INTERVIEWERS = [
  { name: "Dana Whitfield", email: "dana.interviewer@example.com" },
  { name: "Theo Ramsey", email: "theo.interviewer@example.com" },
  { name: "Ines Calder", email: "ines.interviewer@example.com" },
  { name: "Marcus Bell", email: "marcus.interviewer@example.com" },
  { name: "Ruth Okafor", email: "ruth.interviewer@example.com" },
  { name: "Kenji Moreau", email: "kenji.interviewer@example.com" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Small deterministic hash, so ratings and reasons don't change between seeds. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function pick<T>(list: T[], key: string): T {
  return list[hash(key) % list.length];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 500) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/** Seed the synthetic dataset. Returns false when it was already seeded. */
export async function seedSynthetic(db: Db, input: { adminId: string; passwordHash: string }) {
  const ds = generate(OPTIONS);
  const t = ds.tables;

  const slugFor = (job: (typeof t.jobs)[number]) => `${slugify(job.title)}-${job.job_id.toLowerCase()}`;
  const [already] = await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.slug, [slugFor(t.jobs[0])]));
  if (already) return false;

  // Shift every date by whole days so the dataset's observation date is today.
  const today = Math.floor(Date.now() / DAY_MS);
  const shift = today - Math.floor(Date.parse(`${ds.asOf}T00:00:00Z`) / DAY_MS);
  const at = (day: string, hour = 15, minute = 0) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + shift * DAY_MS + (hour * 60 + minute) * 60_000);

  return db.transaction(async (tx) => {
    // Hiring team: one recruiter and a pool of interviewers, all with the demo password.
    await tx
      .insert(users)
      .values([
        { ...RECRUITER, role: "recruiter" as const, passwordHash: input.passwordHash },
        ...INTERVIEWERS.map((u) => ({ ...u, role: "interviewer" as const, passwordHash: input.passwordHash })),
      ])
      .onConflictDoNothing({ target: users.email });
    const teamRows = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.email, [RECRUITER.email, ...INTERVIEWERS.map((u) => u.email)]));
    const userId = new Map(teamRows.map((u) => [u.email, u.id]));
    const recruiterId = userId.get(RECRUITER.email)!;
    const interviewerIds = INTERVIEWERS.map((u) => userId.get(u.email)!);
    // The generator invents many interviewers; fold them onto the demo pool.
    const interviewerFor = (id: string) => interviewerIds[hash(id) % interviewerIds.length];

    /* Jobs, stages, interview plans */
    const jobId = new Map<string, string>();
    const stageId = new Map<string, string>(); // `${job}:${stage}`
    const templateId = new Map<string, string>(); // `${job}:${stage}`
    const team = new Map<string, Set<string>>(); // job uuid -> user ids
    const jobRows: (typeof jobs.$inferInsert)[] = [];
    const stageRows: (typeof stages.$inferInsert)[] = [];
    const templateRows: (typeof interviewTemplates.$inferInsert)[] = [];
    const templateInterviewerRows: (typeof interviewTemplateInterviewers.$inferInsert)[] = [];

    for (const job of t.jobs) {
      const id = randomUUID();
      jobId.set(job.job_id, id);
      team.set(id, new Set([recruiterId]));
      const skills = job.required_skills.split(";");
      jobRows.push({
        id,
        slug: slugFor(job),
        title: job.title,
        department: "Engineering",
        team: job.role_family.replace(/ Engineer$/, ""),
        location: job.location,
        region: "United States",
        headcount: job.openings,
        description:
          `${titleCase(job.level)}-level ${job.role_family.toLowerCase()} joining a small product team.\n\n` +
          `What you'll use: ${skills.join(", ")}.\n\n` +
          `Synthetic demo job generated by synthetic-recruiting.`,
        status: job.status,
        scorecardAttributes: JOB_ATTRIBUTES,
        createdBy: input.adminId,
        createdAt: at(job.opened_date, 9),
        updatedAt: at(job.closed_date ?? job.opened_date, 9),
      });
      STAGE_ORDER.forEach((stage, position) => {
        const sid = randomUUID();
        stageId.set(`${job.job_id}:${stage}`, sid);
        stageRows.push({ id: sid, jobId: id, name: STAGE_NAMES[stage], position });
        const plan = PLAN[stage];
        if (!plan) return;
        const tid = randomUUID();
        templateId.set(`${job.job_id}:${stage}`, tid);
        templateRows.push({
          id: tid,
          jobId: id,
          stageId: sid,
          name: plan.name,
          durationMinutes: plan.minutes,
          attributes: plan.attributes,
          position: 0,
        });
        const defaultInterviewer =
          stage === "recruiter_screen" ? recruiterId : pick(interviewerIds, `${job.job_id}:${stage}`);
        templateInterviewerRows.push({ templateId: tid, userId: defaultInterviewer });
        team.get(id)!.add(defaultInterviewer);
      });
    }
    await tx.insert(jobs).values(jobRows);
    await tx.insert(stages).values(stageRows);
    await tx.insert(interviewTemplates).values(templateRows);
    await tx.insert(interviewTemplateInterviewers).values(templateInterviewerRows);

    /* Candidates */
    const firstApplied = new Map<string, string>();
    for (const a of t.applications) {
      const prev = firstApplied.get(a.candidate_id);
      if (!prev || a.applied_date < prev) firstApplied.set(a.candidate_id, a.applied_date);
    }
    const candidateRows = t.candidates.map((c) => ({
      fullName: c.full_name,
      email: c.email.toLowerCase(),
      phone: c.phone,
      location: c.location,
      source: SOURCES[c.source] ?? titleCase(c.source),
      tags: [c.seniority.toLowerCase()],
      resumeText: [
        `${titleCase(c.seniority)} ${c.role_family}, ${c.years_experience} years of experience.`,
        `Currently at ${c.current_employer}${c.prior_employer ? `; previously at ${c.prior_employer}` : ""}.`,
        `Education: ${c.education.replace(/_/g, " ")}.`,
        `Skills: ${c.skills.split(";").join(", ")}.`,
      ].join("\n"),
      createdAt: at(firstApplied.get(c.candidate_id) ?? ds.asOf, 14),
    }));
    // Emails are unique; a re-run or an existing demo candidate keeps its row.
    await insertChunked(candidateRows, (chunk) =>
      tx.insert(candidates).values(chunk).onConflictDoNothing({ target: candidates.email }),
    );
    const candidateId = new Map<string, string>();
    const emailToToolkit = new Map(t.candidates.map((c) => [c.email.toLowerCase(), c.candidate_id]));
    await insertChunked([...emailToToolkit.keys()], async (emails) => {
      const rows = await tx.select({ id: candidates.id, email: candidates.email }).from(candidates).where(inArray(candidates.email, emails));
      for (const r of rows) candidateId.set(emailToToolkit.get(r.email!)!, r.id);
    });

    /* Applications and their history */
    const eventsByApp = new Map<string, (typeof t.stage_events)[number][]>();
    for (const e of t.stage_events) {
      const list = eventsByApp.get(e.application_id) ?? [];
      list.push(e);
      eventsByApp.set(e.application_id, list);
    }
    const interviewsByAppStage = new Map<string, (typeof t.interviews)[number][]>();
    for (const i of t.interviews) {
      const key = `${i.application_id}:${i.stage}`;
      const list = interviewsByAppStage.get(key) ?? [];
      list.push(i);
      interviewsByAppStage.set(key, list);
    }
    const jobById = new Map(t.jobs.map((j) => [j.job_id, j]));
    const candidateById = new Map(t.candidates.map((c) => [c.candidate_id, c]));

    const appRows: (typeof applications.$inferInsert)[] = [];
    const activityRows: (typeof activity.$inferInsert)[] = [];
    const interviewRows: (typeof interviews.$inferInsert)[] = [];
    const interviewerRows: (typeof interviewInterviewers.$inferInsert)[] = [];
    const scorecardRows: (typeof scorecards.$inferInsert)[] = [];

    for (const a of t.applications) {
      const id = randomUUID();
      const job = jobById.get(a.job_id)!;
      const events = (eventsByApp.get(a.application_id) ?? []).sort(
        (x, y) => STAGE_ORDER.indexOf(x.stage) - STAGE_ORDER.indexOf(y.stage),
      );
      const current = events.at(-1);
      const lastDay = current?.exited_date ?? a.closed_date ?? current?.entered_date ?? a.applied_date;

      // Stalled means the candidate went quiet. On an open job they still sit in the pipeline;
      // on a closed job the recruiter would have closed them out.
      let status: "active" | "hired" | "rejected" | "withdrawn" =
        a.status === "open" || a.status === "stalled" ? "active" : a.status;
      let rejectionReason: string | null = null;
      if (a.status === "stalled" && job.status === "closed") {
        status = "rejected";
        rejectionReason = "Position filled or closed";
      } else if (status === "rejected") {
        rejectionReason = pick(REJECTION_REASONS[a.current_stage], a.application_id);
      }

      appRows.push({
        id,
        candidateId: candidateId.get(a.candidate_id)!,
        jobId: jobId.get(a.job_id)!,
        stageId: stageId.get(`${a.job_id}:${a.current_stage}`)!,
        status,
        rejectionReason,
        appliedAt: at(a.applied_date, 14),
        stageChangedAt: at(current?.entered_date ?? a.applied_date, 15),
      });

      const candidate = candidateById.get(a.candidate_id);
      activityRows.push({
        applicationId: id,
        actorId: null,
        type: "applied",
        data: { source: SOURCES[candidate?.source ?? ""] ?? null },
        createdAt: at(a.applied_date, 14),
      });

      for (const e of events) {
        const stageKey = `${a.job_id}:${e.stage}`;
        const tid = templateId.get(stageKey);
        const plan = PLAN[e.stage];
        const found = interviewsByAppStage.get(`${a.application_id}:${e.stage}`) ?? [];
        const isCurrent = e === current && status === "active";

        if (tid && plan && (found.length > 0 || isCurrent)) {
          const interviewId = randomUUID();
          const scheduled = found.length > 0 ? at(found[0].interview_date, 17) : null;
          const done = found.some((i) => i.result !== "pending");
          interviewRows.push({
            id: interviewId,
            applicationId: id,
            templateId: tid,
            stageId: stageId.get(stageKey)!,
            name: plan.name,
            stageName: STAGE_NAMES[e.stage],
            durationMinutes: plan.minutes,
            attributes: plan.attributes,
            scheduledAt: scheduled,
            completedAt: done && scheduled ? new Date(scheduled.getTime() + plan.minutes * 60_000) : null,
            createdAt: at(e.entered_date, 15, 5),
          });
          // One scorecard per interviewer: several generator interviewers can fold onto one demo user.
          // An interview still to schedule gets one default interviewer and no feedback yet.
          const byUser = new Map<string, (typeof found)[number] | null>();
          for (const i of found) byUser.set(interviewerFor(i.interviewer_id), i);
          if (byUser.size === 0) byUser.set(pick(interviewerIds, `${a.application_id}:${e.stage}`), null);
          for (const [uid, i] of byUser) {
            interviewerRows.push({ interviewId, userId: uid });
            team.get(jobId.get(a.job_id)!)!.add(uid);
            if (!i || i.result === "pending" || !scheduled) continue;
            const pass = i.result === "pass";
            const key = `${i.interview_id}:${uid}`;
            const attrs = plan.attributes.length > 0 ? plan.attributes : JOB_ATTRIBUTES;
            const ratings = Object.fromEntries(
              attrs.map((attr) => [attr, pass ? 3 + (hash(key + attr) % 2) : 1 + (hash(key + attr) % 3)]),
            );
            const strong = hash(key) % 10 < (pass ? 4 : 3);
            const submitted = new Date(scheduled.getTime() + (plan.minutes + 30) * 60_000);
            scorecardRows.push({
              applicationId: id,
              authorId: uid,
              stageName: STAGE_NAMES[e.stage],
              interviewId,
              ratings,
              recommendation: pass ? (strong ? "strong_yes" : "yes") : strong ? "strong_no" : "no",
              summary: pass
                ? pick(
                    [
                      "Clear communicator with solid depth in the areas we covered.",
                      "Worked through the problem methodically and asked good questions.",
                      "Strong on fundamentals. Would like to see more on scope of past work.",
                    ],
                    key,
                  )
                : pick(
                    [
                      "Struggled with the core problem and needed a lot of hints.",
                      "Experience doesn't line up with what this role needs.",
                      "Answers stayed surface level when we went deeper.",
                    ],
                    key,
                  ),
              createdAt: submitted,
              updatedAt: submitted,
            });
            activityRows.push({
              applicationId: id,
              actorId: uid,
              type: "scorecard_submitted",
              data: { stage: STAGE_NAMES[e.stage], interview: plan.name },
              createdAt: submitted,
            });
          }
        }

        if (e.outcome === "advanced" && e.exited_date) {
          const next = STAGE_ORDER[STAGE_ORDER.indexOf(e.stage) + 1];
          activityRows.push({
            applicationId: id,
            actorId: recruiterId,
            type: "stage_changed",
            data: { from: stageId.get(stageKey), to: stageId.get(`${a.job_id}:${next}`) },
            createdAt: at(e.exited_date, 15),
          });
        }
      }

      if (status !== "active") {
        activityRows.push({
          applicationId: id,
          actorId: recruiterId,
          type: status,
          data: rejectionReason ? { reason: rejectionReason } : {},
          createdAt: at(lastDay, 16),
        });
      }
    }

    await insertChunked(appRows, (chunk) => tx.insert(applications).values(chunk));
    await insertChunked(interviewRows, (chunk) => tx.insert(interviews).values(chunk));
    await insertChunked(interviewerRows, (chunk) => tx.insert(interviewInterviewers).values(chunk).onConflictDoNothing());
    await insertChunked(scorecardRows, (chunk) => tx.insert(scorecards).values(chunk));
    await insertChunked(activityRows, (chunk) => tx.insert(activity).values(chunk));
    await tx
      .insert(jobTeam)
      .values([...team].flatMap(([job, ids]) => [...ids].map((uid) => ({ jobId: job, userId: uid }))))
      .onConflictDoNothing();

    return {
      jobs: jobRows.length,
      candidates: candidateRows.length,
      applications: appRows.length,
      interviews: interviewRows.length,
      scorecards: scorecardRows.length,
    };
  });
}
