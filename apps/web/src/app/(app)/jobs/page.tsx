import { and, count, desc, eq, inArray } from "drizzle-orm";
import { applications, jobs } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import Link from "next/link";
import { jobIdsFor } from "@/lib/hiring";
import { can } from "@/lib/permissions";
import { JobsTable } from "./jobs-table";

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const user = await requireUser();
  const mine = (await searchParams).mine === "1";
  const ids = await jobIdsFor(user, mine);

  const rows =
    ids !== null && ids.length === 0
      ? []
      : await db()
          .select({
            id: jobs.id,
            title: jobs.title,
            department: jobs.department,
            team: jobs.team,
            location: jobs.location,
            region: jobs.region,
            headcount: jobs.headcount,
            status: jobs.status,
            active: count(applications.id),
          })
          .from(jobs)
          .leftJoin(
            applications,
            and(eq(applications.jobId, jobs.id), eq(applications.status, "active")),
          )
          .where(ids ? inArray(jobs.id, ids) : undefined)
          .groupBy(jobs.id)
          .orderBy(desc(jobs.createdAt));

  return (
    <>
      <nav aria-label="Which jobs" className="mb-4 flex gap-2 text-sm">
        <Link href="/jobs" className={mine ? "btn btn-secondary" : "btn"} aria-current={mine ? undefined : "page"}>All jobs</Link>
        <Link href="/jobs?mine=1" className={mine ? "btn" : "btn btn-secondary"} aria-current={mine ? "page" : undefined}>My jobs</Link>
      </nav>
      <JobsTable rows={rows} canCreate={can(user, "jobs.create")} />
    </>
  );
}
