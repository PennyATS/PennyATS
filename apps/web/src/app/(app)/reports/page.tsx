import Link from "next/link";
import { and, asc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { activity, applications, candidates, jobs, scorecards, stages, users } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageHiring } from "@/lib/permissions";
import {
  PERIODS,
  daysToHire,
  formatDays,
  funnel,
  median,
  periodStart,
  readPeriod,
  rejectionReasons,
  sources,
  summarizeJob,
  timeInStage,
  type ReportApp,
} from "@/lib/reports";
import { RECOMMENDATIONS, RECOMMENDATION_LABELS, type Recommendation } from "@/lib/scorecards";
import { isUuid } from "@/lib/validation";

const PERIOD_LABELS: Record<keyof typeof PERIODS, string> = {
  "30": "Last 30 days",
  "90": "Last 90 days",
  "365": "Last 12 months",
  all: "All time",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; period?: string }>;
}) {
  await requireUser(canManageHiring);
  const sp = await searchParams;
  const period = readPeriod(sp.period);
  const jobId = sp.job && isUuid(sp.job) ? sp.job : null;
  const start = periodStart(period);

  // Every query below is limited to applications in the selected job and period.
  const appFilter: SQL | undefined = and(
    jobId ? eq(applications.jobId, jobId) : undefined,
    start ? gte(applications.appliedAt, start) : undefined,
  );

  const [allJobs, appRows, eventRows, stageRows, cardRows] = await Promise.all([
    db()
      .select({ id: jobs.id, title: jobs.title, location: jobs.location, status: jobs.status })
      .from(jobs)
      .orderBy(asc(jobs.title)),
    db()
      .select({
        id: applications.id,
        jobId: applications.jobId,
        status: applications.status,
        source: candidates.source,
        appliedAt: applications.appliedAt,
        stageId: applications.stageId,
        rejectionReason: applications.rejectionReason,
      })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .where(appFilter),
    db()
      .select({
        applicationId: applications.id,
        type: activity.type,
        data: activity.data,
        createdAt: activity.createdAt,
      })
      .from(activity)
      .innerJoin(applications, eq(applications.id, activity.applicationId))
      .where(and(appFilter, inArray(activity.type, ["stage_changed", "hired", "rejected", "withdrawn"]))),
    db()
      .select({ id: stages.id, jobId: stages.jobId, name: stages.name, position: stages.position })
      .from(stages)
      .where(jobId ? eq(stages.jobId, jobId) : undefined),
    db()
      .select({ author: users.name, recommendation: scorecards.recommendation })
      .from(scorecards)
      .innerJoin(applications, eq(applications.id, scorecards.applicationId))
      .innerJoin(users, eq(users.id, scorecards.authorId))
      .where(appFilter),
  ]);

  const apps = appRows as ReportApp[];
  const selectedJob = jobId ? allJobs.find((j) => j.id === jobId) : undefined;
  const hireDays = daysToHire(apps, eventRows);

  const perJob = jobId
    ? []
    : allJobs
        .map((job) => ({
          job,
          ...summarizeJob(
            apps.filter((a) => a.jobId === job.id),
            eventRows,
          ),
        }))
        .filter((row) => row.applicants > 0);

  const interviewers = new Map<string, Record<Recommendation, number>>();
  for (const card of cardRows) {
    const counts =
      interviewers.get(card.author) ?? (Object.fromEntries(RECOMMENDATIONS.map((r) => [r, 0])) as Record<Recommendation, number>);
    counts[card.recommendation as Recommendation] += 1;
    interviewers.set(card.author, counts);
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>

      {/* Plain GET form so every report view has a shareable URL. */}
      <form className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <div>
          <label className="label" htmlFor="job">
            Job
          </label>
          <select id="job" name="job" defaultValue={jobId ?? ""} className="input">
            <option value="">All jobs</option>
            {allJobs.map((j) => (
              <option key={j.id} value={j.id}>
                {jobLabel(j)}
                {j.status !== "open" ? ` (${j.status})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="period">
            Applied in
          </label>
          <select id="period" name="period" defaultValue={period} className="input">
            {Object.entries(PERIOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">
          Show
        </button>
      </form>
      <p className="muted mt-2 text-xs">
        Based on {apps.length} application{apps.length === 1 ? "" : "s"} received in this period.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          { label: "Applicants", value: String(apps.length) },
          { label: "Hired", value: String(hireDays.length) },
          { label: "Median time to hire", value: formatDays(median(hireDays)) },
          {
            label: "Fastest / slowest hire",
            value: hireDays.length ? `${formatDays(Math.min(...hireDays))} / ${formatDays(Math.max(...hireDays))}` : "-",
          },
        ].map((stat) => (
          <div key={stat.label} className="card">
            <div className="muted text-xs">{stat.label}</div>
            <div className="mt-1 text-xl font-semibold">{stat.value}</div>
          </div>
        ))}
      </div>

      {selectedJob ? (
        <Section title={`Funnel: ${jobLabel(selectedJob)}`} note="Applicants who reached each stage or a later one.">
          <table className="table">
            <tbody>
              {funnel(stageRows, apps, eventRows).map((row) => (
                <tr key={row.label}>
                  <td className="w-48">{row.label}</td>
                  <td className="w-16 text-right">{row.count}</td>
                  <td>
                    <Bar percent={row.percent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : (
        <Section title="By job" note="Pick a job above to see its stage-by-stage funnel.">
          <Table
            head={["Job", "Applicants", "Active", "Hired", "Rejected", "Withdrawn", "Median time to hire"]}
            rows={perJob.map((r) => [
              <Link key="j" href={`/reports?job=${r.job.id}&period=${period}`} className="link">
                {jobLabel(r.job)}
              </Link>,
              r.applicants,
              r.active,
              r.hired,
              r.rejected,
              r.withdrawn,
              formatDays(r.medianDaysToHire),
            ])}
          />
        </Section>
      )}

      <Section title="Time in stage" note="How long candidates stayed in each stage before moving on or being closed out.">
        <Table
          head={["Stage", "Candidates", "Average", "Median"]}
          rows={timeInStage(stageRows, apps, eventRows).map((r) => [
            r.stage,
            r.samples,
            formatDays(r.averageDays),
            formatDays(r.medianDays),
          ])}
        />
      </Section>

      <Section title="Sources" note="Advanced means they moved past their first stage.">
        <Table
          head={["Source", "Applicants", "Advanced", "Hired"]}
          rows={sources(apps, eventRows).map((r) => [r.source, r.applicants, r.advanced, r.hired])}
        />
      </Section>

      <Section title="Rejection reasons">
        <Table head={["Reason", "Count"]} rows={rejectionReasons(apps).map((r) => [r.reason, r.count])} />
      </Section>

      <Section title="Interviewers" note="Scorecards submitted on applications in this period.">
        <Table
          head={["Interviewer", "Scorecards", ...RECOMMENDATIONS.map((r) => RECOMMENDATION_LABELS[r])]}
          rows={[...interviewers.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, counts]) => [
              name,
              RECOMMENDATIONS.reduce((sum, r) => sum + counts[r], 0),
              ...RECOMMENDATIONS.map((r) => counts[r]),
            ])}
        />
      </Section>
    </>
  );
}

/** Teams often post one title in several places, so include the location. */
function jobLabel(job: { title: string; location: string | null }) {
  return job.location ? `${job.title} · ${job.location}` : job.title;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note && <p className="muted mt-1 text-sm">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <p className="muted text-sm">No data for this period.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A plain percentage bar; no chart library. */
function Bar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 rounded"
        style={{ width: `${Math.max(percent, 1)}%`, maxWidth: "100%", background: "var(--accent)" }}
        aria-hidden="true"
      />
      <span className="muted text-xs">{percent}%</span>
    </div>
  );
}
