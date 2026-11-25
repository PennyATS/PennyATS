/**
 * Report calculations. Pure functions over rows already loaded from the database,
 * so every number on the reports page can be unit tested.
 */

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
    const text = app.rejectionReason?.trim();
    const key = text ? text.toLowerCase() : "";
    const row = rows.get(key) ?? { reason: text || "No reason given", count: 0 };
    row.count += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
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
