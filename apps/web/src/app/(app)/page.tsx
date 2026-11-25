import Link from "next/link";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { aiEnabled } from "@pennyats/ai";
import { applications, jobs, stages } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleJobIds } from "@/lib/hiring";
import { canManageHiring } from "@/lib/permissions";

const stageColors = ["#176B4D", "#2D8361", "#55A27E", "#8BC6A4", "#A4D2B4"];

export default async function Dashboard() {
  const user = await requireUser();
  const ids = await visibleJobIds(user);
  const noVisibleJobs = ids !== null && ids.length === 0;

  let openJobs = 0;
  let activeApplications = 0;
  let openRoles: { id: string; title: string; department: string | null }[] = [];
  let stageCounts: { name: string | null; total: number }[] = [];

  if (!noVisibleJobs) {
    const [[open], [active], roles, pipeline] = await Promise.all([
      db().select({ total: count() }).from(jobs)
        .where(and(eq(jobs.status, "open"), ids ? inArray(jobs.id, ids) : undefined)),
      db().select({ total: count() }).from(applications)
        .where(and(eq(applications.status, "active"), ids ? inArray(applications.jobId, ids) : undefined)),
      db().select({ id: jobs.id, title: jobs.title, department: jobs.department }).from(jobs)
        .where(and(eq(jobs.status, "open"), ids ? inArray(jobs.id, ids) : undefined))
        .orderBy(desc(jobs.updatedAt)).limit(3),
      db().select({ name: stages.name, total: count() }).from(applications)
        .leftJoin(stages, eq(applications.stageId, stages.id))
        .where(and(eq(applications.status, "active"), ids ? inArray(applications.jobId, ids) : undefined))
        .groupBy(stages.name).orderBy(desc(count())),
    ]);
    openJobs = open.total;
    activeApplications = active.total;
    openRoles = roles;
    stageCounts = pipeline;
  }

  const pipeline = stageCounts.slice(0, 4).map((stage) => ({
    label: stage.name ?? "Unassigned",
    total: stage.total,
  }));
  if (stageCounts.length > 4) {
    pipeline.push({
      label: "Other stages",
      total: stageCounts.slice(4).reduce((sum, stage) => sum + stage.total, 0),
    });
  }
  const largestStage = Math.max(1, ...pipeline.map((stage) => stage.total));
  const ai = aiEnabled();

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] leading-[38px] font-bold tracking-[-0.045em]">Dashboard</h1>
          <p className="muted mt-2 text-sm">A clear view of your hiring, all in one place.</p>
        </div>
        {canManageHiring(user.role) && (
          <Link href="/jobs/new" className="btn min-h-9 px-4 text-[13px]">+ New job</Link>
        )}
      </header>

      <section aria-label="Hiring overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="dashboard-card flex min-h-[134px] flex-col justify-between">
          <h2 className="muted text-[13px] font-semibold">Open jobs</h2>
          <div className="flex items-baseline gap-2.5">
            <span className="text-4xl leading-10 font-bold tracking-[-0.06em]">{openJobs}</span>
            <span className="text-xs text-[#76877B]">roles hiring</span>
          </div>
        </div>
        <div className="dashboard-card flex min-h-[134px] flex-col justify-between">
          <h2 className="muted text-[13px] font-semibold">Active applications</h2>
          <div className="flex items-baseline gap-2.5">
            <span className="text-4xl leading-10 font-bold tracking-[-0.06em]">{activeApplications}</span>
            <span className="text-xs text-[#76877B]">in progress</span>
          </div>
        </div>
        <div className="dashboard-card flex min-h-[134px] flex-col justify-between sm:col-span-2 lg:col-span-1">
          <h2 className="muted text-[13px] font-semibold">AI features</h2>
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className={`size-[9px] rounded-full ${ai ? "bg-[#4B9B76]" : "bg-[#A1A3AF]"}`} />
            <span className="text-[27px] leading-8 font-semibold tracking-[-0.045em]">{ai ? "On" : "Off"}</span>
            <span className="text-xs text-[#76877B]">for this workspace</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="pipeline-title" className={`dashboard-card !p-6 ${pipeline.length > 2 ? "min-h-[324px]" : "min-h-[260px]"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="pipeline-title" className="text-lg leading-6 font-semibold tracking-[-0.03em]">Pipeline snapshot</h2>
            <p className="mt-1 text-xs text-[#76877B]">Where your active applications stand today</p>
          </div>
          <span className="rounded-[7px] border border-[var(--border)] px-3 py-2 text-xs text-[#4D6153]">All visible jobs</span>
        </div>
        {pipeline.length === 0 ? (
          <p className="muted flex min-h-48 items-center justify-center text-sm">No active applications yet.</p>
        ) : (
          <div className="mt-8 space-y-5">
            {pipeline.map((stage, index) => (
              <div key={stage.label} className="flex items-center gap-3 sm:gap-5">
                <span className="w-24 shrink-0 break-words text-[13px] font-medium text-[#4D6153] sm:w-[150px]" title={stage.label}>{stage.label}</span>
                <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-md bg-[#EAF2EC]" role="img" aria-label={`${stage.label}: ${stage.total} active applications`}>
                  <div className="h-full rounded-md" style={{ width: `${(stage.total / largestStage) * 95}%`, backgroundColor: stageColors[index] }} />
                </div>
                <span className="w-8 shrink-0 text-right text-[13px] font-semibold sm:w-[72px]">{stage.total}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.74fr)_minmax(0,1fr)]">
        <section aria-labelledby="roles-title" className="dashboard-card !p-0">
          <div className="flex items-center justify-between gap-3 px-6 py-5">
            <h2 id="roles-title" className="text-base font-semibold tracking-tight">Open roles</h2>
            <Link href="/jobs" className="text-xs font-semibold text-[var(--accent)] hover:underline">View all jobs →</Link>
          </div>
          {openRoles.length === 0 ? (
            <p className="muted px-6 pb-6 text-sm">No open jobs yet.</p>
          ) : (
            <ul className="px-6 pb-5">
              {openRoles.map((job) => (
                <li key={job.id} className="flex items-center justify-between gap-4 border-t border-[#E8EEE9] py-2">
                  <Link href={`/jobs/${job.id}`} className="min-w-0 hover:text-[var(--accent)]">
                    <span className="block truncate text-xs font-semibold">{job.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-[#76877B]">{job.department ?? "No department"}</span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[#3D8765]">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-[#4B9B76]" />Open
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="quick-title" className="dashboard-card !p-0">
          <h2 id="quick-title" className="px-6 py-5 text-base font-semibold tracking-tight">Quick access</h2>
          <div className="px-6 pb-5">
            {[
              { href: "/candidates", label: "Review candidates" },
              { href: "/jobs", label: canManageHiring(user.role) ? "Manage jobs" : "Browse jobs" },
              { href: canManageHiring(user.role) ? "/reports" : "/careers", label: canManageHiring(user.role) ? "Explore reports" : "Careers page" },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="flex min-h-10 items-center justify-between gap-3 border-t border-[#E8EEE9] text-xs font-medium text-[#4D6153] hover:text-[var(--accent)]">
                {item.label}<span aria-hidden="true" className="text-base text-[#76877B]">→</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
