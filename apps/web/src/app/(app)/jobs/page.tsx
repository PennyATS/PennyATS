import Link from "next/link";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { applications, jobs } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleJobIds } from "@/lib/hiring";
import { canManageHiring } from "@/lib/permissions";

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
            location: jobs.location,
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        {canManageHiring(user.role) && (
          <Link href="/jobs/new" className="btn">
            New job
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="muted mt-6 text-sm">
          {canManageHiring(user.role) ? "No jobs yet." : "You aren't on any hiring teams yet."}
        </p>
      ) : (
        <table className="table mt-6">
          <thead>
            <tr>
              <th>Title</th>
              <th>Department</th>
              <th>Location</th>
              <th>Status</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((job) => (
              <tr key={job.id}>
                <td>
                  <Link href={`/jobs/${job.id}`} className="link">
                    {job.title}
                  </Link>
                </td>
                <td>{job.department}</td>
                <td>{job.location}</td>
                <td className="capitalize">{job.status}</td>
                <td>{job.active}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
