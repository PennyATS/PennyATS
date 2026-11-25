import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { jobs } from "@pennyats/db";
import { db } from "@/lib/db";

// Reads live job data on every request (and keeps the build from needing a database).
export const dynamic = "force-dynamic";

export const metadata = { title: "Careers" };

export default async function CareersPage() {
  const open = await db()
    .select({ slug: jobs.slug, title: jobs.title, department: jobs.department, location: jobs.location })
    .from(jobs)
    .where(eq(jobs.status, "open"))
    .orderBy(asc(jobs.department), asc(jobs.title));

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Open roles</h1>
      {open.length === 0 ? (
        <p className="muted mt-4 text-sm">No open roles right now. Check back soon.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {open.map((job) => (
            <li key={job.slug} className="card">
              <Link href={`/careers/${job.slug}`} className="font-medium hover:underline">
                {job.title}
              </Link>
              <div className="muted text-sm">
                {[job.department, job.location].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
