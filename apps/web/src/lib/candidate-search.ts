import { and, desc, eq, exists, gte, ilike, inArray, isNotNull, lt, not, or, sql, type SQL } from "drizzle-orm";
import { activity, applications, candidates, notes, stages } from "@pennyats/db";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { visibleJobIds } from "./hiring";
import { likePattern, parseQuery, type QueryNode } from "./search-query";
import { isUuid } from "./validation";

/** Candidate list filters. All optional; they combine with AND. Kept in the URL. */
export type CandidateFilters = {
  /** Boolean search over profile, tags, resume, notes, and activity. */
  q?: string;
  name?: string;
  email?: string;
  source?: string;
  job?: string;
  /** Stage name, matched case-insensitively so it works across jobs. */
  stage?: string;
  status?: "active" | "hired" | "rejected" | "withdrawn";
  tag?: string;
  /** Added on or after / before, as YYYY-MM-DD. */
  from?: string;
  to?: string;
};

const KEYS = ["q", "name", "email", "source", "job", "stage", "status", "tag", "from", "to"] as const;
const STATUSES = ["active", "hired", "rejected", "withdrawn"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readFilters(params: Record<string, string | string[] | undefined> | URLSearchParams): CandidateFilters {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s.slice(0, 200) : undefined;
  };
  const status = get("status");
  const from = get("from");
  const to = get("to");
  const job = get("job");
  return {
    q: get("q"),
    name: get("name"),
    email: get("email"),
    source: get("source"),
    job: job && isUuid(job) ? job : undefined,
    stage: get("stage"),
    status: (STATUSES as readonly string[]).includes(status ?? "") ? (status as CandidateFilters["status"]) : undefined,
    tag: get("tag")?.replace(/^#/, "").toLowerCase(),
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
  };
}

/** The filters as a query string (no leading "?"), for links that keep the list context. */
export function filtersQuery(filters: CandidateFilters): string {
  const params = new URLSearchParams();
  for (const k of KEYS) {
    const v = filters[k];
    if (v) params.set(k, v);
  }
  return params.toString();
}

export function hasFilters(filters: CandidateFilters): boolean {
  return KEYS.some((k) => Boolean(filters[k]));
}

/** SQL for one search term: anywhere in the profile, resume, notes, or application history. */
function termMatches(term: string, jobIds: string[] | null): SQL {
  const p = likePattern(term);
  const visibleApps = jobIds ? inArray(applications.jobId, jobIds) : undefined;
  return or(
    ilike(candidates.fullName, p),
    ilike(candidates.email, p),
    ilike(candidates.phone, p),
    ilike(candidates.location, p),
    ilike(candidates.source, p),
    sql`array_to_string(${candidates.tags}, ' ') ilike ${p}`,
    ilike(candidates.resumeText, p),
    exists(
      db()
        .select({ x: sql`1` })
        .from(notes)
        .where(and(eq(notes.candidateId, candidates.id), ilike(notes.body, p))),
    ),
    // Rejection reasons and other application history, on jobs the user can see.
    exists(
      db()
        .select({ x: sql`1` })
        .from(applications)
        .where(
          and(
            eq(applications.candidateId, candidates.id),
            visibleApps,
            or(
              ilike(applications.rejectionReason, p),
              exists(
                db()
                  .select({ x: sql`1` })
                  .from(activity)
                  .where(and(eq(activity.applicationId, applications.id), sql`${activity.data}::text ilike ${p}`)),
              ),
            ),
          ),
        ),
    ),
  )!;
}

function compile(node: QueryNode, jobIds: string[] | null): SQL {
  switch (node.type) {
    case "term":
      return termMatches(node.value, jobIds);
    case "not":
      return not(compile(node.node, jobIds));
    case "and":
      return and(...node.nodes.map((n) => compile(n, jobIds)))!;
    case "or":
      return or(...node.nodes.map((n) => compile(n, jobIds)))!;
  }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** WHERE clause for the filters, limited to what the user may see. */
async function whereFor(user: SessionUser, filters: CandidateFilters): Promise<SQL | null> {
  const ids = await visibleJobIds(user);
  if (ids !== null && ids.length === 0) return null;
  const query = filters.q ? parseQuery(filters.q) : null;

  // Application-level filters apply to one application, so "job X in stage Y" means the same one.
  const appConditions = [
    filters.job ? eq(applications.jobId, filters.job) : undefined,
    filters.status ? eq(applications.status, filters.status) : undefined,
    filters.stage ? sql`lower(${stages.name}) = ${filters.stage.toLowerCase()}` : undefined,
  ].filter(Boolean);
  const visible = ids ? inArray(applications.jobId, ids) : undefined;
  const needsApp = appConditions.length > 0 || ids !== null;

  return and(
    filters.name ? ilike(candidates.fullName, likePattern(filters.name)) : undefined,
    filters.email ? ilike(candidates.email, likePattern(filters.email)) : undefined,
    filters.source ? sql`lower(${candidates.source}) = ${filters.source.toLowerCase()}` : undefined,
    filters.tag ? sql`exists (select 1 from unnest(${candidates.tags}) as t(v) where lower(t.v) = ${filters.tag})` : undefined,
    filters.from ? gte(candidates.createdAt, sql`${addDays(filters.from, 0)}::timestamptz`) : undefined,
    filters.to ? lt(candidates.createdAt, sql`${addDays(filters.to, 1)}::timestamptz`) : undefined,
    query ? compile(query, ids) : undefined,
    // Interviewers only see candidates with an application on one of their jobs.
    needsApp
      ? exists(
          db()
            .select({ x: sql`1` })
            .from(applications)
            .leftJoin(stages, eq(stages.id, applications.stageId))
            .where(and(eq(applications.candidateId, candidates.id), visible, ...appConditions)),
        )
      : undefined,
  ) ?? sql`true`;
}

export type CandidateListRow = {
  id: string;
  name: string;
  email: string | null;
  source: string | null;
  tags: string[];
  createdAt: Date;
};

/** Candidates matching the filters, newest first. */
export async function searchCandidates(
  user: SessionUser,
  filters: CandidateFilters,
  limit: number,
): Promise<CandidateListRow[]> {
  const where = await whereFor(user, filters);
  if (!where) return [];
  return db()
    .select({
      id: candidates.id,
      name: candidates.fullName,
      email: candidates.email,
      source: candidates.source,
      tags: candidates.tags,
      createdAt: candidates.createdAt,
    })
    .from(candidates)
    .where(where)
    .orderBy(desc(candidates.createdAt), desc(candidates.id))
    .limit(limit);
}

/**
 * Previous and next candidate around `current` in the filtered list, for fast review.
 * If the current candidate has dropped out of the list (say, just rejected while
 * reviewing active candidates), neighbors are where they would sort.
 */
export async function reviewNeighbors(
  user: SessionUser,
  filters: CandidateFilters,
  current: { id: string; createdAt: Date },
): Promise<{ prev: string | null; next: string | null; position: number | null; total: number }> {
  const where = await whereFor(user, filters);
  if (!where) return { prev: null, next: null, position: null, total: 0 };
  const rows = await db()
    .select({ id: candidates.id, createdAt: candidates.createdAt })
    .from(candidates)
    .where(where)
    .orderBy(desc(candidates.createdAt), desc(candidates.id))
    .limit(5000);
  const index = rows.findIndex((r) => r.id === current.id);
  if (index >= 0) {
    return { prev: rows[index - 1]?.id ?? null, next: rows[index + 1]?.id ?? null, position: index + 1, total: rows.length };
  }
  // Sorted newest first, ties by id descending.
  const after = rows.findIndex(
    (r) => r.createdAt < current.createdAt || (r.createdAt.getTime() === current.createdAt.getTime() && r.id < current.id),
  );
  const insert = after === -1 ? rows.length : after;
  return { prev: rows[insert - 1]?.id ?? null, next: rows[insert]?.id ?? null, position: null, total: rows.length };
}

/** Distinct values for the filter dropdowns, limited to what the user can see. */
export async function filterOptions(user: SessionUser) {
  const ids = await visibleJobIds(user);
  if (ids !== null && ids.length === 0) return { sources: [], stages: [], tags: [] };
  const visible = ids ? inArray(applications.jobId, ids) : undefined;
  const seen = ids
    ? exists(db().select({ x: sql`1` }).from(applications).where(and(eq(applications.candidateId, candidates.id), visible)))
    : undefined;
  const [sources, stageNames, tags] = await Promise.all([
    db().selectDistinct({ v: candidates.source }).from(candidates).where(and(isNotNull(candidates.source), seen)),
    db().selectDistinct({ v: stages.name }).from(stages).where(ids ? inArray(stages.jobId, ids) : undefined),
    db()
      .selectDistinct({ v: sql<string>`unnest(${candidates.tags})` })
      .from(candidates)
      .where(seen),
  ]);
  const sorted = (rows: { v: string | null }[]) =>
    [...new Set(rows.map((r) => r.v).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
  // Stage names repeat per job; collapse case variants.
  const stageList = [...new Map(stageNames.map((r) => [r.v.toLowerCase(), r.v])).values()].sort((a, b) => a.localeCompare(b));
  return { sources: sorted(sources), stages: stageList, tags: sorted(tags) };
}
