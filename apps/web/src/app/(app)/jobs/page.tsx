import { and, count, desc, eq, inArray } from "drizzle-orm";
import { applications, jobs } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleJobIds } from "@/lib/hiring";
import { can } from "@/lib/permissions";
import { JobsTable } from "./jobs-table";

export default async function JobsPage() {
  const user = await requireUser();
  const ids = await visibleJobIds(user);

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

  return <JobsTable rows={rows} canCreate={can(user, "jobs.create")} />;
}
