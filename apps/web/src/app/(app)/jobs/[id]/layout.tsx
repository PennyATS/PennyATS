import Link from "next/link";
import { Suspense } from "react";
import { asc, count, eq, inArray } from "drizzle-orm";
import { applications, jobTeam, users } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { can } from "@/lib/permissions";
import { EMPLOYMENT_TYPES, PRIORITIES, WORKPLACE_TYPES, formatCompensation } from "@/lib/job-fields";
import { DetailsButton, JobDrawer, JobRail } from "./job-chrome";

/** Header, sub-navigation, and details drawer shared by every page of one job. */
export default async function JobLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const manage = can(user, "jobs.edit");
  const { job, stages } = await loadJob(user, id);

  const [statusCounts, team] = await Promise.all([
    db().select({ status: applications.status, n: count() }).from(applications).where(eq(applications.jobId, job.id)).groupBy(applications.status),
    db()
      .select({ id: users.id, name: users.name, role: users.role })
      .from(jobTeam)
      .innerJoin(users, eq(users.id, jobTeam.userId))
      .where(eq(jobTeam.jobId, job.id))
      .orderBy(asc(users.name)),
  ]);
  const n = (s: string) => statusCounts.find((c) => c.status === s)?.n ?? 0;
  const all = statusCounts.reduce((a, c) => a + c.n, 0);
  const peopleIds = [job.hiringManagerId, job.recruiterId].filter((x): x is string => Boolean(x));
  const people = peopleIds.length ? await db().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, peopleIds)) : [];
  const personName = (pid: string | null) => (pid ? people.find((p) => p.id === pid)?.name : undefined);
  const pay = can(user, "jobs.view_compensation") ? formatCompensation({ ...job, compPeriod: job.compPeriod as "year" | "hour" | null }) : null;
  const base = `/jobs/${job.id}`;

  const details: [string, React.ReactNode][] = [
    ["Status", <span key="s" className={`data-status data-status-${job.status}`}>{job.status}</span>],
    ["Department", job.department],
    ["Team", job.team],
    ["Location", [job.location, job.region].filter(Boolean).join(", ")],
    ["Workplace", job.workplaceType && WORKPLACE_TYPES[job.workplaceType as keyof typeof WORKPLACE_TYPES]],
    ["Employment", job.employmentType && EMPLOYMENT_TYPES[job.employmentType as keyof typeof EMPLOYMENT_TYPES]],
    ["Openings", job.headcount],
    ["Requisition", job.requisitionId],
    ["Hiring manager", personName(job.hiringManagerId)],
    ["Recruiter", personName(job.recruiterId)],
    ...(manage ? ([
      ["Compensation", pay && `${pay}${job.compMid ? ` (mid ${job.compMid.toLocaleString()})` : ""}${job.compPublic ? " · shown on careers page" : ""}`],
      ["Equity", job.equityNote],
    ] as [string, React.ReactNode][]) : []),
    ["Target start", job.targetStartDate],
    ["Priority", job.priority && PRIORITIES[job.priority as keyof typeof PRIORITIES]],
    ["Visibility", job.confidential ? "Confidential (not on careers page)" : job.status === "open" ? "Listed on careers page" : "Not listed"],
  ];

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.04em]">{job.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={`data-status data-status-${job.status}`}>{job.status}</span>
            <span className="muted">{[job.department, job.location].filter(Boolean).join(" · ")}</span>
            {job.confidential && <span className="data-status data-status-draft">Confidential</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Suspense fallback={<span className="btn btn-secondary">Job details</span>}>
            <DetailsButton className="btn btn-secondary">Job details</DetailsButton>
          </Suspense>
          {job.status === "open" && !job.confidential && (
            <Link href={`/careers/${job.slug}`} className="btn btn-secondary">Job board ↗</Link>
          )}
          {manage && <Link href={`${base}/add-candidate`} className="btn">Add candidate</Link>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[12.5rem_minmax(0,1fr)]">
        <Suspense fallback={<div />}>
        <JobRail
          jobId={job.id}
          activity={[
            { href: `${base}?view=board`, label: "Candidate pipeline", view: "board", count: n("active") },
            { href: base, label: "Dashboard", view: "" },
            { href: `${base}?view=list`, label: "All applications", view: "list", count: all },
            { href: `${base}?view=archived`, label: "Archived", view: "archived", count: n("rejected") + n("withdrawn") },
          ]}
          admin={
            manage
              ? [
                  { href: `${base}/edit`, label: "Settings" },
                  { href: `${base}/interview-plan`, label: "Interview plan" },
                  { href: `${base}/scheduling`, label: "Stage automation" },
                ]
              : []
          }
        />
        </Suspense>
        <div className="min-w-0">{children}</div>
      </div>

      <Suspense>
      <JobDrawer title={job.title}>
        <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[9rem_1fr]">
          {details
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="muted">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>

        <h3 className="mt-6 text-sm font-semibold">Pipeline</h3>
        <ol className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true" className="muted">→</span>}
              <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--border)" }}>{s.name}</span>
            </li>
          ))}
        </ol>

        <h3 className="mt-6 text-sm font-semibold">Hiring team</h3>
        {team.length === 0 ? (
          <p className="muted mt-1 text-sm">Nobody on the hiring team yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {team.map((m) => (
              <li key={m.id} className="rounded-md border px-2.5 py-1" style={{ borderColor: "var(--border)" }}>
                {m.name} <span className="muted text-xs capitalize">{m.role}</span>
              </li>
            ))}
          </ul>
        )}

        {manage && job.internalNotes && (
          <>
            <h3 className="mt-6 text-sm font-semibold">Internal notes</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm">{job.internalNotes}</p>
          </>
        )}

        <h3 className="mt-6 text-sm font-semibold">Description</h3>
        {job.description ? (
          <div className="mt-1 whitespace-pre-wrap text-sm leading-6">{job.description}</div>
        ) : (
          <p className="muted mt-1 text-sm">No description yet.</p>
        )}

        {manage && (
          <p className="mt-6">
            <Link href={`${base}/edit`} className="btn btn-secondary">Edit job</Link>
          </p>
        )}
      </JobDrawer>
      </Suspense>
    </>
  );
}
