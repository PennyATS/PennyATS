import Link from "next/link";
import { and, count, eq, inArray } from "drizzle-orm";
import { applications, stages } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleJobIds } from "@/lib/hiring";
import { can } from "@/lib/permissions";
import { checklistSummary, showChecklistOnHome } from "@/lib/setup-checklist";
import { loadChecklist } from "@/lib/setup-checklist-data";
import { pipelineSnapshot } from "@/lib/candidate-review";
import { myWork, teamActivity } from "@/lib/dashboard-data";
import { LocalTime } from "@/components/local-time";

const stageColors = ["#176B4D", "#2D8361", "#55A27E", "#8BC6A4", "#A4D2B4", "#0F4A35"];

function Panel({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`dashboard-card !p-0 ${className}`} aria-label={title}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-[#f3f7f4] px-4 py-6 text-center text-sm text-[var(--muted)]">{children}</p>;
}

export default async function Home() {
  const user = await requireUser();
  const manage = can(user, "jobs.create");
  const ids = await visibleJobIds(user);
  const [work, team, stageCounts] = await Promise.all([
    myWork(user),
    teamActivity(user),
    ids !== null && ids.length === 0
      ? []
      : db()
          .select({ name: stages.name, total: count() })
          .from(applications)
          .leftJoin(stages, eq(applications.stageId, stages.id))
          .where(and(eq(applications.status, "active"), ids ? inArray(applications.jobId, ids) : undefined))
          .groupBy(stages.name),
  ]);
  // Fixed order (Applied → Offer) so the snapshot reads like a funnel; see pipelineSnapshot.
  const pipeline = stageCounts.length ? pipelineSnapshot(stageCounts) : [];
  const largestStage = Math.max(1, ...pipeline.map((stage) => stage.total));
  const reviewTotal = team.reviewByJob.reduce((a, r) => a + r.n, 0);
  const first = user.name.split(" ")[0];
  const admin = can(user, "settings.manage");
  const checklist = admin ? await loadChecklist(user.id) : null;
  const setup = checklist && showChecklistOnHome(admin, checklist.steps, checklist.state)
    ? checklistSummary(checklist.steps)
    : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.04em]">Home</h1>
          <p className="muted mt-1 text-sm">Welcome back, {first}. Here&apos;s what needs you today.</p>
        </div>
        {manage && <Link href="/jobs/new" className="btn min-h-9 px-4 text-[13px]">+ New job</Link>}
      </header>

      {setup && (
        <section className="dashboard-card flex flex-wrap items-center justify-between gap-3" aria-label="Finish setting up">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Finish setting up</h2>
            <p className="muted mt-0.5 text-sm">
              {setup.done} of {setup.total} steps done: company name, first job, email, calendar, AI, and your team.
            </p>
          </div>
          <Link href="/settings/setup" className="btn min-h-9 px-4 text-[13px]">Open setup checklist</Link>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="My interviews" action={<span className="muted text-xs">Upcoming</span>}>
            {work.upcoming.length === 0 ? (
              <Empty>No interviews scheduled for you.</Empty>
            ) : (
              <ul className="card-rows text-sm">
                {work.upcoming.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/candidates/${i.candidateId}`} className="font-medium hover:underline">{i.candidate}</Link>
                      <div className="muted truncate text-xs">{i.name} · {i.job}</div>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums"><LocalTime iso={i.scheduledAt!.toISOString()} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Tasks" action={<span className="muted text-xs">Feedback you owe</span>}>
            {work.owed.length === 0 ? (
              <Empty>No tasks. You&apos;re all caught up.</Empty>
            ) : (
              <ul className="card-rows text-sm">
                {work.owed.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/candidates/${i.candidateId}`} className="font-medium hover:underline">{i.candidate}</Link>
                      <div className="muted truncate text-xs">{i.name} · {i.job}</div>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      {i.overdue && <span className="data-status data-status-closed">Overdue</span>}
                      <Link href={`/applications/${i.applicationId}/scorecard?interview=${i.id}`} className="btn btn-secondary !min-h-8 px-3 text-xs">Submit feedback</Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <section aria-labelledby="pipeline-title" className="dashboard-card !p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="pipeline-title" className="text-[15px] font-semibold tracking-tight">Pipeline snapshot</h2>
                <p className="mt-1 text-xs text-[#76877B]">Where active applications stand today</p>
              </div>
              <span className="rounded-[7px] border border-[var(--border)] px-3 py-1.5 text-xs text-[#4D6153]">{team.active} active</span>
            </div>
            {pipeline.length === 0 ? (
              <Empty>No active applications yet.</Empty>
            ) : (
              <div className="mt-6 space-y-4">
                {pipeline.map((stage, index) => (
                  <div key={stage.label} className="flex items-center gap-3 sm:gap-5">
                    <span className="w-28 shrink-0 text-[13px] font-medium text-[#4D6153] sm:w-[150px]">{stage.label}</span>
                    <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-md bg-[#EAF2EC]" role="img" aria-label={`${stage.label}: ${stage.total} active applications`}>
                      <div className="h-full rounded-md" style={{ width: `${(stage.total / largestStage) * 95}%`, backgroundColor: stageColors[index] }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[13px] font-semibold tabular-nums">{stage.total}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <Panel title="Activities">
            <ul className="card-rows text-sm">
              {[
                { label: "Application review", n: reviewTotal, href: "/candidates?status=active&stage=Applied" },
                { label: "Interviews to schedule", n: team.toSchedule, href: "/dashboards/jobs" },
                { label: "Overdue feedback", n: team.overdue, href: "/dashboards/jobs" },
                { label: "Active candidates", n: team.active, href: "/candidates?status=active" },
              ].map((row) => (
                <li key={row.label}>
                  <Link href={row.href} className="flex items-center justify-between gap-3 hover:text-[var(--accent)]">
                    <span>{row.label}</span>
                    <span className={`tabular-nums ${row.n > 0 ? "font-semibold text-[var(--accent)]" : "muted"}`}>{row.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          {team.reviewByJob.length > 0 && (
            <Panel title="Application review">
              <ul className="card-rows text-sm">
                {team.reviewByJob.slice(0, 6).map((r) => (
                  <li key={r.jobId}>
                    <Link href={`/jobs/${r.jobId}?view=board`} className="flex items-center justify-between gap-3 hover:text-[var(--accent)]">
                      <span className="min-w-0 truncate">{r.job}</span>
                      <span className="muted shrink-0 text-xs">{r.n} application{r.n === 1 ? "" : "s"} ›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Jobs" action={<Link href="/jobs" className="text-xs font-semibold text-[var(--accent)] hover:underline">View all jobs</Link>}>
            {team.openJobs.length === 0 ? (
              <Empty>No open jobs.</Empty>
            ) : (
              <ul className="card-rows text-sm">
                {team.openJobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 hover:text-[var(--accent)]">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{j.title}</span>
                        <span className="muted block truncate text-xs">{[j.department, j.location].filter(Boolean).join(" | ") || "No location"}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">{j.active}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
