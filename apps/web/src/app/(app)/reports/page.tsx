import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageHiring } from "@/lib/permissions";
import { loadReportInput } from "@/lib/report-data";
import {
  PERIODS,
  daysToHire,
  formatDays,
  jobLabel,
  median,
  readPeriod,
  reportTables,
  type Cell,
  type ReportTable,
  type ReportTableId,
} from "@/lib/reports";
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

  const input = await loadReportInput(jobId, period);
  const tables = reportTables(input);
  const selectedJob = jobId ? input.jobs.find((j) => j.id === jobId) : undefined;
  const hireDays = daysToHire(input.apps, input.events);
  const query = `${jobId ? `job=${jobId}&` : ""}period=${period}`;
  const csv = (id: ReportTableId) => `/api/reports/${id}?${query}`;

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
            {input.jobs.map((j) => (
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
        Based on {input.apps.length} application{input.apps.length === 1 ? "" : "s"} received in this period.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          { label: "Applicants", value: String(input.apps.length) },
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

      {tables.funnel && selectedJob ? (
        <Section
          title={`Funnel: ${jobLabel(selectedJob)}`}
          note="Applicants who reached each stage or a later one."
          csvHref={csv("funnel")}
        >
          <table className="table">
            <tbody>
              {tables.funnel.rows.map(([label, count, percent]) => (
                <tr key={String(label)}>
                  <td className="w-48">{label}</td>
                  <td className="w-16 text-right">{count}</td>
                  <td>
                    <Bar percent={Number(percent)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : (
        tables.jobs && (
          <Section title="By job" note="Pick a job above to see its stage-by-stage funnel." csvHref={csv("jobs")}>
            <Table
              table={tables.jobs}
              firstCell={(value, i) => (
                <Link href={`/reports?job=${tables.jobIds[i]}&period=${period}`} className="link">
                  {value}
                </Link>
              )}
            />
          </Section>
        )
      )}

      <Section
        title="Time in stage"
        note="Days candidates stayed in each stage before moving on or being closed out."
        csvHref={csv("stages")}
      >
        {tables.stages && <Table table={tables.stages} />}
      </Section>

      <Section title="Sources" note="Advanced means they moved past their first stage." csvHref={csv("sources")}>
        {tables.sources && <Table table={tables.sources} />}
      </Section>

      <Section title="Rejection reasons" csvHref={csv("reasons")}>
        {tables.reasons && <Table table={tables.reasons} />}
      </Section>

      <Section title="Interviewers" note="Scorecards submitted on applications in this period." csvHref={csv("interviewers")}>
        {tables.interviewers && <Table table={tables.interviewers} />}
      </Section>
    </>
  );
}

function Section({
  title,
  note,
  csvHref,
  children,
}: {
  title: string;
  note?: string;
  csvHref: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <a href={csvHref} className="link text-xs" download>
          Download CSV
        </a>
      </div>
      {note && <p className="muted mt-1 text-sm">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Table({
  table,
  firstCell,
}: {
  table: ReportTable;
  firstCell?: (value: Cell, rowIndex: number) => React.ReactNode;
}) {
  if (table.rows.length === 0) return <p className="muted text-sm">No data for this period.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          {table.head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((cells, i) => (
          <tr key={i}>
            {cells.map((value, j) => (
              <td key={j}>{j === 0 && firstCell ? firstCell(value, i) : (value ?? "-")}</td>
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
