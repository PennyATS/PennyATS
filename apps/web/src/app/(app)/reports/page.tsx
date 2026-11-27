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
import { BarChart, ChartToggle, DonutChart, LineChart, StackedBarChart } from "@/components/charts";
import { foldOther, monthLabel } from "@/lib/charts";

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
          <ChartToggle
            id="funnel"
            graph={<BarChart rows={tables.funnel.rows.map(([label, count]) => ({ label: String(label), value: Number(count) }))} />}
            table={
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
            }
          />
        </Section>
      ) : (
        tables.jobs && (
          <Section title="By job" note="Pick a job above to see its stage-by-stage funnel." csvHref={csv("jobs")}>
            <ChartToggle
              id="jobs"
              graph={
                <StackedBarChart
                  series={["Active", "Hired", "Rejected", "Withdrawn"]}
                  rows={tables.jobs.rows.map((r) => ({ label: String(r[0]), values: [2, 3, 4, 5].map((i) => Number(r[i])) }))}
                />
              }
              table={
                <Table
                  table={tables.jobs}
                  firstCell={(value, i) => (
                    <Link href={`/reports?job=${tables.jobIds[i]}&period=${period}`} className="link">
                      {value}
                    </Link>
                  )}
                />
              }
            />
          </Section>
        )
      )}

      {tables.apply && (
        <Section
          title="Careers apply funnel"
          note="Public job page views, people who started the apply form, and successful submits. Anonymous counts only."
          csvHref={csv("apply")}
        >
          <ChartToggle
            id="apply"
            graph={<BarChart rows={tables.apply.rows.map(([label, count]) => ({ label: String(label), value: Number(count) }))} />}
            table={
              <table className="table">
                <tbody>
                  {tables.apply.rows.map(([label, count, percent]) => (
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
            }
          />
        </Section>
      )}

      {tables.trend && (
        <Section title="Applications and hires over time" note="Per month. Hires are counted in the month they were marked hired." csvHref={csv("trend")}>
          <ChartToggle
            id="trend"
            graph={
              // Two charts rather than one with two scales: hires are a much smaller number.
              <div className="grid gap-6 lg:grid-cols-2">
                {([["Applications", 1, "#2a78d6"], ["Hires", 2, "#eb6834"]] as const).map(([name, col, color]) => (
                  <div key={name}>
                    <h3 className="mb-1 text-sm font-medium">{name} per month</h3>
                    <LineChart
                      height={190}
                      width={380}
                      color={color}
                      labels={tables.trend!.rows.map((r) => monthLabel(String(r[0])))}
                      series={[{ name, values: tables.trend!.rows.map((r) => Number(r[col])) }]}
                    />
                  </div>
                ))}
              </div>
            }
            table={<Table table={tables.trend} />}
          />
        </Section>
      )}

      <Section
        title="Time in stage"
        note="Days candidates stayed in each stage before moving on or being closed out. The graph shows the median."
        csvHref={csv("stages")}
      >
        {tables.stages && (
          <ChartToggle
            id="stages"
            graph={
              <BarChart
                unit=" d"
                rows={tables.stages.rows.filter((r) => r[3] !== null && r[3] !== "-").map((r) => ({ label: String(r[0]), value: Number(r[3]) }))}
              />
            }
            table={<Table table={tables.stages} />}
          />
        )}
      </Section>

      <Section title="Sources" note="Advanced means they moved past their first stage." csvHref={csv("sources")}>
        {tables.sources && (
          <ChartToggle
            id="sources"
            graph={<DonutChart centerLabel="applicants" rows={foldOther(tables.sources.rows.map((r) => ({ label: String(r[0]), value: Number(r[1]) })))} />}
            table={<Table table={tables.sources} />}
          />
        )}
      </Section>

      <Section title="Rejection reasons" csvHref={csv("reasons")}>
        {tables.reasons && (
          <ChartToggle
            id="reasons"
            graph={<DonutChart centerLabel="rejected" rows={foldOther(tables.reasons.rows.map((r) => ({ label: String(r[0]), value: Number(r[1]) })))} />}
            table={<Table table={tables.reasons} />}
          />
        )}
      </Section>

      <Section title="Interviewers" note="Scorecards submitted on applications in this period." csvHref={csv("interviewers")}>
        {tables.interviewers && (
          <ChartToggle
            id="interviewers"
            graph={
              <StackedBarChart
                series={["Strong no", "No", "Yes", "Strong yes"]}
                rows={tables.interviewers.rows.map((r) => ({ label: String(r[0]), values: [2, 3, 4, 5].map((i) => Number(r[i])) }))}
              />
            }
            table={<Table table={tables.interviewers} />}
          />
        )}
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
    <section className="report-section relative mt-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pr-24">
        <h2 className="text-lg font-semibold">{title}</h2>
        <a href={csvHref} className="link text-xs" download>
          Download CSV
        </a>
      </div>
      {note && <p className="muted mt-1 text-sm">{note}</p>}
      <div className="mt-4 overflow-x-auto">{children}</div>
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
