/**
 * Report calculations. Pure functions over rows already loaded from the database,
 * so every number on the reports page can be unit tested.
 */

import { rejectionReasonKey } from "./candidate-review";
import { monthKey, monthRange } from "./charts";

export type ReportApp = {
  id: string;
  jobId: string;
  status: "active" | "hired" | "rejected" | "withdrawn";
  source: string | null;
  appliedAt: Date;
  stageId: string | null;
  rejectionReason: string | null;
};

export type ReportEvent = {
  applicationId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: Date;
};

export type ReportStage = { id: string; jobId: string; name: string; position: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSING_EVENTS = new Set(["hired", "rejected", "withdrawn"]);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

const days = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;

/** Events grouped by application, oldest first. */
function eventsByApp(events: ReportEvent[]): Map<string, ReportEvent[]> {
  const map = new Map<string, ReportEvent[]>();
  for (const e of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const list = map.get(e.applicationId) ?? [];
    list.push(e);
    map.set(e.applicationId, list);
  }
  return map;
}

export type Segment = { stageId: string; start: Date; end: Date | null };

/**
 * The stages an application passed through, with when it entered and left each.
 * The starting stage comes from the first move's "from" (or the current stage if it never moved).
 * A segment ends at the next move, or when the application was hired, rejected, or withdrawn.
 * end is null while the candidate is still in that stage.
 */
export function stageTimeline(app: ReportApp, events: ReportEvent[]): Segment[] {
  const moves = events.filter((e) => e.type === "stage_changed" && typeof e.data.to === "string");
  const closed = events.filter((e) => CLOSING_EVENTS.has(e.type)).at(-1);

  const firstFrom = moves[0]?.data.from;
  const startStage = typeof firstFrom === "string" ? firstFrom : moves.length === 0 ? app.stageId : null;

  const entries: { stageId: string; at: Date }[] = [];
  if (startStage) entries.push({ stageId: startStage, at: app.appliedAt });
  for (const m of moves) entries.push({ stageId: m.data.to as string, at: m.createdAt });

  return entries.map((entry, i) => ({
    stageId: entry.stageId,
    start: entry.at,
    end: entries[i + 1]?.at ?? (app.status !== "active" && closed ? closed.createdAt : null),
  }));
}

export type FunnelRow = { label: string; count: number; percent: number };

/**
 * For one job: how many applicants reached each stage (or any later one), plus hired.
 * Uses current stage order; stages that were deleted are ignored.
 */
export function funnel(stages: ReportStage[], apps: ReportApp[], events: ReportEvent[]): FunnelRow[] {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const rank = new Map(ordered.map((s, i) => [s.id, i]));
  const byApp = eventsByApp(events);

  const furthest = apps.map((app) => {
    const reached = stageTimeline(app, byApp.get(app.id) ?? [])
      .map((seg) => rank.get(seg.stageId))
      .filter((r): r is number => r !== undefined);
    return reached.length ? Math.max(...reached) : -1;
  });

  const total = apps.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const rows = ordered.map((stage, i) => {
    // Hired candidates count as reaching every stage, even if a recruiter skipped some.
    const count = apps.filter((app, j) => furthest[j] >= i || app.status === "hired").length;
    return { label: stage.name, count, percent: pct(count) };
  });
  const hired = apps.filter((a) => a.status === "hired").length;
  return [...rows, { label: "Hired", count: hired, percent: pct(hired) }];
}

export type StageTime = { stage: string; samples: number; averageDays: number; medianDays: number };

/** Days spent in each stage (grouped by stage name), from completed stays only. */
export function timeInStage(stages: ReportStage[], apps: ReportApp[], events: ReportEvent[]): StageTime[] {
  const nameOf = new Map(stages.map((s) => [s.id, s.name]));
  const order = new Map<string, number>();
  for (const s of [...stages].sort((a, b) => a.position - b.position)) {
    if (!order.has(s.name)) order.set(s.name, s.position);
  }
  const byApp = eventsByApp(events);
  const durations = new Map<string, number[]>();

  for (const app of apps) {
    for (const seg of stageTimeline(app, byApp.get(app.id) ?? [])) {
      const name = nameOf.get(seg.stageId);
      if (!name || !seg.end) continue;
      const list = durations.get(name) ?? [];
      list.push(days(seg.start, seg.end));
      durations.set(name, list);
    }
  }

  return [...durations.entries()]
    .map(([stage, list]) => ({
      stage,
      samples: list.length,
      averageDays: average(list) ?? 0,
      medianDays: median(list) ?? 0,
    }))
    .sort((a, b) => (order.get(a.stage) ?? 0) - (order.get(b.stage) ?? 0));
}

/** Days from applying to being marked hired, for each hired application. */
export function daysToHire(apps: ReportApp[], events: ReportEvent[]): number[] {
  const byApp = eventsByApp(events);
  return apps.flatMap((app) => {
    if (app.status !== "hired") return [];
    const hiredAt = (byApp.get(app.id) ?? []).filter((e) => e.type === "hired").at(-1)?.createdAt;
    return hiredAt ? [days(app.appliedAt, hiredAt)] : [];
  });
}

export type SourceRow = { source: string; applicants: number; advanced: number; hired: number };

/** Applicants per source, how many got past their first stage, and how many were hired. */
export function sources(apps: ReportApp[], events: ReportEvent[]): SourceRow[] {
  const byApp = eventsByApp(events);
  const rows = new Map<string, SourceRow>();
  for (const app of apps) {
    const source = app.source?.trim() || "Unknown";
    const row = rows.get(source) ?? { source, applicants: 0, advanced: 0, hired: 0 };
    row.applicants += 1;
    const moved = (byApp.get(app.id) ?? []).some((e) => e.type === "stage_changed");
    if (moved || app.status === "hired") row.advanced += 1;
    if (app.status === "hired") row.hired += 1;
    rows.set(source, row);
  }
  return [...rows.values()].sort((a, b) => b.applicants - a.applicants || a.source.localeCompare(b.source));
}

/** Rejection reasons, grouped case-insensitively, most common first. */
export function rejectionReasons(apps: ReportApp[]): { reason: string; count: number }[] {
  const rows = new Map<string, { reason: string; count: number }>();
  for (const app of apps) {
    if (app.status !== "rejected") continue;
    // A note after the standard reason ("Reason — note") doesn't split the group.
    const text = app.rejectionReason?.trim() ? rejectionReasonKey(app.rejectionReason.trim()) : "";
    const key = text ? text.toLowerCase() : "";
    const row = rows.get(key) ?? { reason: text || "No reason given", count: 0 };
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** Applications received and hires made per calendar month (UTC), with no gaps. */
export function monthlyTrend(apps: ReportApp[], events: ReportEvent[]): { month: string; applications: number; hires: number }[] {
  const hiredAt = new Map<string, Date>();
  const ids = new Set(apps.filter((a) => a.status === "hired").map((a) => a.id));
  for (const e of events) {
    if (e.type === "hired" && ids.has(e.applicationId)) hiredAt.set(e.applicationId, e.createdAt);
  }
  const dates = [...apps.map((a) => a.appliedAt), ...hiredAt.values()];
  if (dates.length === 0) return [];
  const months = monthRange(new Date(Math.min(...dates.map(Number))), new Date(Math.max(...dates.map(Number))));
  const rows = new Map(months.map((m) => [m, { month: m, applications: 0, hires: 0 }]));
  for (const a of apps) rows.get(monthKey(a.appliedAt))!.applications += 1;
  for (const at of hiredAt.values()) rows.get(monthKey(at))!.hires += 1;
  return [...rows.values()];
}

export type JobSummary = {
  applicants: number;
  active: number;
  hired: number;
  rejected: number;
  withdrawn: number;
  medianDaysToHire: number | null;
};

export function summarizeJob(apps: ReportApp[], events: ReportEvent[]): JobSummary {
  const count = (s: ReportApp["status"]) => apps.filter((a) => a.status === s).length;
  return {
    applicants: apps.length,
    active: count("active"),
    hired: count("hired"),
    rejected: count("rejected"),
    withdrawn: count("withdrawn"),
    medianDaysToHire: median(daysToHire(apps, events)),
  };
}

export const PERIODS = { "30": 30, "90": 90, "365": 365, all: null } as const;
export type Period = keyof typeof PERIODS;

export function readPeriod(value: string | undefined): Period {
  return value && value in PERIODS ? (value as Period) : "90";
}

/** Earliest applied date included in the period, or null for all time. */
export function periodStart(period: Period, now: Date = new Date()): Date | null {
  const n = PERIODS[period];
  return n === null ? null : new Date(now.getTime() - n * DAY_MS);
}

/** "3.5 days", "under a day" */
export function formatDays(value: number | null): string {
  if (value === null) return "-";
  if (value < 1) return "under a day";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

/* ---------- Tables shared by the reports page and CSV downloads ---------- */

export type ReportJob = { id: string; title: string; location: string | null; status: string };
export type ReportCard = { author: string; recommendation: string };

export type Cell = string | number | null;
export type ReportTable = { head: string[]; rows: Cell[][] };

export type ReportInput = {
  jobs: ReportJob[];
  jobId: string | null;
  apps: ReportApp[];
  events: ReportEvent[];
  stages: ReportStage[];
  cards: ReportCard[];
};

export const REPORT_TABLES = ["funnel", "jobs", "trend", "stages", "sources", "reasons", "interviewers"] as const;
export type ReportTableId = (typeof REPORT_TABLES)[number];

/** Teams often post one title in several places, so include the location. */
export function jobLabel(job: { title: string; location: string | null }): string {
  return job.location ? `${job.title} · ${job.location}` : job.title;
}

/** Days rounded to one decimal, or null when there's nothing to measure. */
const dayCell = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);

const RECS = ["strong_no", "no", "yes", "strong_yes"] as const;
const REC_HEAD = ["Strong no", "No", "Yes", "Strong yes"];

/**
 * Every report table as plain rows. The page renders these and the CSV download
 * exports them, so the two can never disagree. `funnel` is only present for a
 * single job and `jobs` only for all jobs.
 */
export function reportTables(input: ReportInput): Partial<Record<ReportTableId, ReportTable>> & {
  jobIds: string[];
} {
  const { apps, events, stages } = input;
  const tables: Partial<Record<ReportTableId, ReportTable>> = {};
  let jobIds: string[] = [];

  if (input.jobId) {
    tables.funnel = {
      head: ["Stage", "Candidates", "Percent of applicants"],
      rows: funnel(stages, apps, events).map((r) => [r.label, r.count, r.percent]),
    };
  } else {
    const perJob = input.jobs
      .map((job) => ({ job, ...summarizeJob(apps.filter((a) => a.jobId === job.id), events) }))
      .filter((r) => r.applicants > 0);
    jobIds = perJob.map((r) => r.job.id);
    tables.jobs = {
      head: ["Job", "Applicants", "Active", "Hired", "Rejected", "Withdrawn", "Median days to hire"],
      rows: perJob.map((r) => [
        jobLabel(r.job),
        r.applicants,
        r.active,
        r.hired,
        r.rejected,
        r.withdrawn,
        dayCell(r.medianDaysToHire),
      ]),
    };
  }

  tables.trend = {
    head: ["Month", "Applications", "Hires"],
    rows: monthlyTrend(apps, events).map((r) => [r.month, r.applications, r.hires]),
  };
  tables.stages = {
    head: ["Stage", "Candidates", "Average days", "Median days"],
    rows: timeInStage(stages, apps, events).map((r) => [r.stage, r.samples, dayCell(r.averageDays), dayCell(r.medianDays)]),
  };
  tables.sources = {
    head: ["Source", "Applicants", "Advanced", "Hired"],
    rows: sources(apps, events).map((r) => [r.source, r.applicants, r.advanced, r.hired]),
  };
  tables.reasons = {
    head: ["Reason", "Count"],
    rows: rejectionReasons(apps).map((r) => [r.reason, r.count]),
  };

  const byAuthor = new Map<string, number[]>();
  for (const card of input.cards) {
    const counts = byAuthor.get(card.author) ?? RECS.map(() => 0);
    const i = RECS.indexOf(card.recommendation as (typeof RECS)[number]);
    if (i >= 0) counts[i] += 1;
    byAuthor.set(card.author, counts);
  }
  tables.interviewers = {
    head: ["Interviewer", "Scorecards", ...REC_HEAD],
    rows: [...byAuthor.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, counts]) => [name, counts.reduce((a, b) => a + b, 0), ...counts]),
  };

  return { ...tables, jobIds };
}
