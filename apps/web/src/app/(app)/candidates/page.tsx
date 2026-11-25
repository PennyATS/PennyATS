import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { applications, jobs, stages } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleJobIds } from "@/lib/hiring";
import { filterOptions, filtersQuery, hasFilters, readFilters, searchCandidates } from "@/lib/candidate-search";

const PAGE_SIZE = 100;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = readFilters(sp);
  const filtered = hasFilters(filters);
  const ids = await visibleJobIds(user);

  const [rows, options, jobList] = await Promise.all([
    searchCandidates(user, filters, PAGE_SIZE),
    filterOptions(user),
    ids !== null && ids.length === 0
      ? []
      : db()
          .select({ id: jobs.id, title: jobs.title, status: jobs.status })
          .from(jobs)
          .where(ids ? inArray(jobs.id, ids) : undefined)
          .orderBy(asc(jobs.title)),
  ]);

  // Each listed candidate's applications on jobs the user can see.
  const apps = rows.length
    ? await db()
        .select({
          candidateId: applications.candidateId,
          jobTitle: jobs.title,
          stage: stages.name,
          status: applications.status,
        })
        .from(applications)
        .innerJoin(jobs, eq(jobs.id, applications.jobId))
        .leftJoin(stages, eq(stages.id, applications.stageId))
        .where(
          and(
            inArray(applications.candidateId, rows.map((r) => r.id)),
            ids ? inArray(applications.jobId, ids) : undefined,
          ),
        )
    : [];
  const appsBy = Map.groupBy(apps, (a) => a.candidateId);
  const context = filtersQuery(filters);
  const profileHref = (id: string) => `/candidates/${id}${context ? `?${context}` : ""}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
          <p className="muted mt-1 text-sm">
            {rows.length === PAGE_SIZE ? `Newest ${PAGE_SIZE} matches` : `${rows.length} candidate${rows.length === 1 ? "" : "s"}`}
            {filtered && " · filtered"}
          </p>
        </div>
      </div>
      {sp.deleted && (
        <p role="status" className="mt-2 text-sm">
          Candidate permanently deleted.
        </p>
      )}

      {/* Plain GET form: every filtered view has a shareable URL. */}
      <form className="card mt-4 space-y-3 !p-4" role="search" aria-label="Search and filter candidates">
        <div className="flex flex-wrap gap-2">
          <label htmlFor="q" className="sr-only">Search</label>
          <input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder='Search resumes, notes, and activity: python AND (django OR flask) -intern "machine learning"'
            className="input min-w-0 flex-1"
          />
          <button type="submit" className="btn">Search</button>
          {filtered && (
            <Link href="/candidates" className="btn btn-secondary">Clear</Link>
          )}
        </div>
        <details className="text-xs">
          <summary className="link cursor-pointer">Search syntax</summary>
          <p className="muted mt-1">
            Words must all appear (AND). Use <code>OR</code> for either, <code>NOT word</code> or <code>-word</code> to
            exclude, quotes for a phrase, and parentheses to group. Searches name, email, phone, location, source,
            tags, resume text, notes, phone screen notes, rejection reasons, and application history.
          </p>
        </details>

        <div className="data-table-scroll rounded-lg">
          <table className="data-table w-full min-w-[1080px]">
            <thead>
              <tr>
                <th className="px-2.5">Name</th>
                <th className="px-2.5">Email</th>
                <th className="px-2.5">Tags</th>
                <th className="px-2.5">Source</th>
                <th className="px-2.5">Job</th>
                <th className="px-2.5">Stage</th>
                <th className="px-2.5">Status</th>
                <th className="px-2.5">Added</th>
              </tr>
              <tr className="data-filter-row">
                <th>
                  <label htmlFor="f-name" className="sr-only">Filter by name</label>
                  <input id="f-name" name="name" defaultValue={filters.name} placeholder="Contains" className="input" />
                </th>
                <th>
                  <label htmlFor="f-email" className="sr-only">Filter by email</label>
                  <input id="f-email" name="email" defaultValue={filters.email} placeholder="Contains" className="input" />
                </th>
                <th>
                  <label htmlFor="f-tag" className="sr-only">Filter by tag</label>
                  <select id="f-tag" name="tag" defaultValue={filters.tag ?? ""} className="input">
                    <option value="">Any</option>
                    {options.tags.map((t) => <option key={t} value={t}>#{t}</option>)}
                  </select>
                </th>
                <th>
                  <label htmlFor="f-source" className="sr-only">Filter by source</label>
                  <select id="f-source" name="source" defaultValue={filters.source ?? ""} className="input">
                    <option value="">Any</option>
                    {options.sources.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </th>
                <th>
                  <label htmlFor="f-job" className="sr-only">Filter by job</label>
                  <select id="f-job" name="job" defaultValue={filters.job ?? ""} className="input">
                    <option value="">Any</option>
                    {jobList.map((j) => (
                      <option key={j.id} value={j.id}>{j.title}{j.status !== "open" ? ` (${j.status})` : ""}</option>
                    ))}
                  </select>
                </th>
                <th>
                  <label htmlFor="f-stage" className="sr-only">Filter by stage</label>
                  <select id="f-stage" name="stage" defaultValue={filters.stage ?? ""} className="input">
                    <option value="">Any</option>
                    {options.stages.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </th>
                <th>
                  <label htmlFor="f-status" className="sr-only">Filter by status</label>
                  <select id="f-status" name="status" defaultValue={filters.status ?? ""} className="input">
                    <option value="">Any</option>
                    <option value="active">Active</option>
                    <option value="hired">Hired</option>
                    <option value="rejected">Archived: rejected</option>
                    <option value="withdrawn">Archived: withdrawn</option>
                  </select>
                </th>
                <th>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="f-from" className="sr-only">Added from</label>
                    <input id="f-from" name="from" type="date" defaultValue={filters.from} className="input" title="Added on or after" />
                    <label htmlFor="f-to" className="sr-only">Added to</label>
                    <input id="f-to" name="to" type="date" defaultValue={filters.to} className="input" title="Added on or before" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="data-empty">{filtered ? "No candidates match these filters." : "No candidates yet."}</td>
                </tr>
              ) : (
                rows.map((c) => {
                  const mine = appsBy.get(c.id) ?? [];
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={profileHref(c.id)} className="data-job-title">{c.name}</Link>
                      </td>
                      <td><span className="data-primary">{c.email}</span></td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {c.tags.slice(0, 4).map((t) => (
                            <Link key={t} href={`/candidates?tag=${encodeURIComponent(t)}`} className="tag">#{t}</Link>
                          ))}
                          {c.tags.length > 4 && <span className="muted text-xs">+{c.tags.length - 4}</span>}
                        </div>
                      </td>
                      <td>{c.source}</td>
                      <td>
                        {mine.length === 0 ? <span className="muted">-</span> : (
                          <>
                            <div className="data-primary">{mine[0].jobTitle}</div>
                            {mine.length > 1 && <div className="data-secondary">+{mine.length - 1} more</div>}
                          </>
                        )}
                      </td>
                      <td>{mine[0]?.stage ?? "-"}</td>
                      <td>
                        {mine[0] && (
                          <span className={`data-status data-status-${mine[0].status === "active" ? "open" : mine[0].status === "hired" ? "draft" : "closed"}`}>
                            {mine[0].status === "rejected" || mine[0].status === "withdrawn" ? "archived" : mine[0].status}
                          </span>
                        )}
                      </td>
                      <td className="data-numeric">{c.createdAt.toLocaleDateString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Enter in any filter submits; this button is for mouse users and selects. */}
        <div className="flex justify-end">
          <button type="submit" className="btn btn-secondary">Apply filters</button>
        </div>
      </form>
      {rows.length === PAGE_SIZE && (
        <p className="muted mt-3 text-sm">Showing the newest {PAGE_SIZE}. Narrow the search or filters to see others.</p>
      )}
    </>
  );
}
