/**
 * Health checks for one job's pipeline. Pure functions over rows the job page already
 * loads, so every rule here is unit tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Defaults for the checks. Kept in one place so they are easy to tune later. */
export const HEALTH_RULES = {
  /** A candidate sitting in one stage longer than this is "stuck". */
  stuckDays: 14,
  /** A stage holding at least this share of active candidates (and at least `bottleneckMin`) is a bottleneck. */
  bottleneckShare: 0.4,
  bottleneckMin: 3,
  /** Past the first stage, feedback is expected within this many days of entering a stage. */
  feedbackDays: 3,
  /** An open job with no new applicants for this long gets flagged. */
  quietDays: 14,
} as const;

export type HealthApp = {
  id: string;
  candidateId: string;
  name: string;
  status: "active" | "hired" | "rejected" | "withdrawn";
  stageId: string | null;
  appliedAt: Date;
  stageChangedAt: Date;
};

export type HealthStage = { id: string; name: string; position: number };

export type HealthInput = {
  jobStatus: "draft" | "open" | "closed";
  apps: HealthApp[];
  stages: HealthStage[];
  /** Scorecards on this job's applications: which application and which stage name they were filed under. */
  scorecards: { applicationId: string; stageName: string }[];
  teamSize: number;
  /** Interviews whose feedback is overdue (see isOverdue in interviews.ts). */
  overdueInterviews?: { candidateId: string; name: string; interview: string; missing: string[] }[];
  /** Applications with a live interview in their current stage; the interview check covers their feedback. */
  appsWithInterviews?: string[];
  now?: Date;
};

export type HealthCheck = {
  id: "draft" | "team" | "quiet" | "stuck" | "bottleneck" | "feedback" | "interviews";
  level: "warn" | "info";
  title: string;
  detail: string;
  /** Candidates the check is about, for links. */
  candidates: { id: string; name: string }[];
};

const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Everything that needs attention on this job, most important first. Empty means healthy. */
export function jobHealth(input: HealthInput): HealthCheck[] {
  const now = input.now ?? new Date();
  const checks: HealthCheck[] = [];
  const active = input.apps.filter((a) => a.status === "active");
  const ordered = [...input.stages].sort((a, b) => a.position - b.position);
  const stageName = new Map(ordered.map((s) => [s.id, s.name]));
  const firstStageId = ordered[0]?.id ?? null;

  const stuck = active.filter((a) => daysBetween(a.stageChangedAt, now) > HEALTH_RULES.stuckDays);
  if (stuck.length) {
    checks.push({
      id: "stuck",
      level: "warn",
      title: `${plural(stuck.length, "candidate")} stuck in a stage`,
      detail: `No movement for more than ${HEALTH_RULES.stuckDays} days. Move them forward or close them out.`,
      candidates: stuck.map((a) => ({ id: a.candidateId, name: a.name })),
    });
  }

  const overdue = input.overdueInterviews ?? [];
  if (overdue.length) {
    checks.push({
      id: "interviews",
      level: "warn",
      title: `${plural(overdue.length, "interview")} with overdue feedback`,
      detail: overdue
        .slice(0, 6)
        .map((o) => `${o.name}, ${o.interview}: waiting on ${o.missing.join(", ")}`)
        .join(". ") + (overdue.length > 6 ? `, and ${overdue.length - 6} more.` : "."),
      candidates: [...new Map(overdue.map((o) => [o.candidateId, { id: o.candidateId, name: o.name }])).values()],
    });
  }

  // Feedback: past the first stage, a candidate should have at least one scorecard for the
  // stage they're in once they've been there a few days. Stages with interviews are covered
  // by the interview check above, so they're skipped here.
  const scored = new Set(input.scorecards.map((s) => `${s.applicationId}|${s.stageName}`));
  const withInterviews = new Set(input.appsWithInterviews ?? []);
  const missing = active.filter((a) => {
    if (withInterviews.has(a.id)) return false;
    if (!a.stageId || a.stageId === firstStageId) return false;
    if (daysBetween(a.stageChangedAt, now) <= HEALTH_RULES.feedbackDays) return false;
    return !scored.has(`${a.id}|${stageName.get(a.stageId)}`);
  });
  if (missing.length) {
    checks.push({
      id: "feedback",
      level: "warn",
      title: `${plural(missing.length, "candidate")} waiting on feedback`,
      detail: `In their current stage for more than ${HEALTH_RULES.feedbackDays} days with no scorecard yet.`,
      candidates: missing.map((a) => ({ id: a.candidateId, name: a.name })),
    });
  }

  for (const stage of ordered) {
    const inStage = active.filter((a) => a.stageId === stage.id);
    if (
      inStage.length >= HEALTH_RULES.bottleneckMin &&
      inStage.length / active.length >= HEALTH_RULES.bottleneckShare
    ) {
      checks.push({
        id: "bottleneck",
        level: "warn",
        title: `${stage.name} is a bottleneck`,
        detail: `${inStage.length} of ${active.length} active candidates are waiting here.`,
        candidates: [],
      });
    }
  }

  if (input.jobStatus === "open") {
    const latest = input.apps.reduce<Date | null>((max, a) => (!max || a.appliedAt > max ? a.appliedAt : max), null);
    if (!latest || daysBetween(latest, now) > HEALTH_RULES.quietDays) {
      checks.push({
        id: "quiet",
        level: "warn",
        title: latest ? "No new applicants recently" : "No applicants yet",
        detail: latest
          ? `The last application was ${Math.floor(daysBetween(latest, now))} days ago. Consider sourcing or sharing the posting.`
          : "Share the careers page link or add candidates you've sourced.",
        candidates: [],
      });
    }
  }

  if (input.teamSize === 0) {
    checks.push({
      id: "team",
      level: "info",
      title: "No hiring team",
      detail: "Add interviewers on the edit page so they can see this job and submit scorecards.",
      candidates: [],
    });
  }

  if (input.jobStatus === "draft") {
    checks.push({
      id: "draft",
      level: "info",
      title: "Draft job",
      detail: "It isn't on the careers page yet. Set the status to Open when you're ready to receive applicants.",
      candidates: [],
    });
  }

  return checks;
}

/** Applicants per week for the last `weeks` weeks, oldest first. Weeks end at `now`. */
export function weeklyApplicants(
  apps: { appliedAt: Date }[],
  weeks = 8,
  now: Date = new Date(),
): { start: Date; count: number }[] {
  const out = Array.from({ length: weeks }, (_, i) => ({
    start: new Date(now.getTime() - (weeks - i) * 7 * DAY_MS),
    count: 0,
  }));
  for (const app of apps) {
    const ago = (now.getTime() - app.appliedAt.getTime()) / (7 * DAY_MS);
    if (ago < 0 || ago >= weeks) continue;
    out[weeks - 1 - Math.floor(ago)].count += 1;
  }
  return out;
}

/** Whole days since a date, never negative. */
export const daysSince = (date: Date, now: Date = new Date()) => Math.max(0, Math.floor(daysBetween(date, now)));
