import Link from "next/link";
import { and, count, desc, eq, ilike, inArray, isNotNull, or } from "drizzle-orm";
import { applications, candidates } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleJobIds } from "@/lib/hiring";

const PAGE_SIZE = 100;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const ids = await visibleJobIds(user);

  // Escape LIKE wildcards so a search for "50%" means the literal text.
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const search = q ? or(ilike(candidates.fullName, pattern), ilike(candidates.email, pattern)) : undefined;

  const rows =
    ids !== null && ids.length === 0
      ? []
      : await db()
          .select({
            id: candidates.id,
            name: candidates.fullName,
            email: candidates.email,
            source: candidates.source,
            createdAt: candidates.createdAt,
            apps: count(applications.id),
          })
          .from(candidates)
          .leftJoin(
            applications,
            and(eq(applications.candidateId, candidates.id), ids ? inArray(applications.jobId, ids) : undefined),
          )
          // Interviewers only see candidates with an application on one of their jobs.
          .where(and(search, ids ? isNotNull(applications.id) : undefined))
          .groupBy(candidates.id)
          .orderBy(desc(candidates.createdAt))
          .limit(PAGE_SIZE);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Candidates</h1>
      <form className="mt-4 flex max-w-md gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name or email"
          aria-label="Search candidates"
          className="input"
        />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="muted mt-6 text-sm">{q ? "No matches." : "No candidates yet."}</p>
      ) : (
        <table className="table mt-6">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Source</th>
              <th>Applications</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/candidates/${c.id}`} className="link">
                    {c.name}
                  </Link>
                </td>
                <td>{c.email}</td>
                <td>{c.source}</td>
                <td>{c.apps}</td>
                <td>{c.createdAt.toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length === PAGE_SIZE && (
        <p className="muted mt-3 text-sm">Showing the newest {PAGE_SIZE}. Search to narrow down.</p>
      )}
    </>
  );
}
