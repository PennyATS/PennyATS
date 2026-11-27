import { requireUser } from "@/lib/auth";
import { EXEC_PERIODS, execPeriodStart, executiveData, type ExecPeriod } from "@/lib/dashboard-data";
import { monthKey, monthLabel, monthRange, foldOther } from "@/lib/charts";
import { ChartToggle, ColumnChart } from "@/components/charts";

export const metadata = { title: "Executive dashboard" };

function Kpi({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="dashboard-card flex min-h-[132px] flex-col">
      <h2 className="text-[13px] font-medium text-[#4d6153]" title={note}>{label}</h2>
      {value === null ? (
        <div className="m-auto flex flex-col items-center rounded-md bg-[#f3f7f4] px-4 py-2 text-xs text-[var(--muted)]">
          <span aria-hidden="true">ⓘ</span>No results
        </div>
      ) : (
        <div className="mt-auto text-center text-[40px] leading-none font-semibold tracking-[-0.04em] tabular-nums">{value}</div>
      )}
    </div>
  );
}

export default async function ExecutiveDashboard({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; department?: string }>;
}) {
  const user = await requireUser("dashboards.executive");
  const sp = await searchParams;
  const period: ExecPeriod = sp.period && sp.period in EXEC_PERIODS ? (sp.period as ExecPeriod) : "year";
  const department = sp.department?.trim().slice(0, 200) || null;
  const data = await executiveData(user, period, department);

  // Hires by department.
  const byDept = new Map<string, number>();
  for (const h of data.hires) byDept.set(h.department ?? "No department", (byDept.get(h.department ?? "No department") ?? 0) + 1);
  const deptRows = [...byDept.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const total = data.hires.length;

  // Monthly hires, stacked by department (top 7, the rest as Other).
  const start = execPeriodStart(period) ?? (data.hires.length ? new Date(Math.min(...data.hires.map((h) => h.at.getTime()))) : new Date());
  const months = monthRange(start, new Date());
  const shown = foldOther(deptRows, 7).map((r) => r.label);
  const keyOf = (d: string) => (shown.includes(d) ? d : "Other");
  const series = shown.map((name) => ({
    name,
    values: months.map((m) => data.hires.filter((h) => monthKey(h.at) === m && keyOf(h.department ?? "No department") === name).length),
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.04em]">Executive dashboard</h1>

      <form className="dashboard-card flex flex-wrap items-end gap-3 !py-4" aria-label="Filters">
        <div>
          <label htmlFor="period" className="label">Period</label>
          <select id="period" name="period" defaultValue={period} className="input">
            {Object.entries(EXEC_PERIODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="department" className="label">Department</label>
          <select id="department" name="department" defaultValue={department ?? ""} className="input">
            <option value="">All departments</option>
            {data.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">Apply</button>
      </form>

      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Hires" value={total} />
        <Kpi label="Offer acceptance rate" value={null} note="Offers aren't tracked yet." />
        <Kpi label="Completed interviews" value={data.completedInterviews} />
        <Kpi label="Upcoming interviews" value={data.upcomingInterviews} />
        <Kpi label="All open jobs" value={data.openJobs} />
        <Kpi label="Active candidates" value={data.activeCandidates} />
      </section>

      <h2 className="dashboard-card !py-3.5 text-[15px] font-semibold">Hires</h2>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <section className="dashboard-card !p-0" aria-labelledby="dept-title">
          <h3 id="dept-title" className="px-5 py-4 text-[15px] font-semibold">Hires by department</h3>
          {deptRows.length === 0 ? (
            <p className="muted px-5 pb-5 text-sm">No hires in this period.</p>
          ) : (
            <table className="table !rounded-none !border-x-0 !border-b-0">
              <thead>
                <tr><th>Department</th><th className="text-right">Percent</th><th className="text-right">Count</th></tr>
              </thead>
              <tbody>
                {deptRows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="text-right tabular-nums">{((r.value / total) * 100).toFixed(1)}%</td>
                    <td className="text-right tabular-nums">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="report-section relative !p-5" aria-labelledby="monthly-title">
          <h3 id="monthly-title" className="pr-24 text-[15px] font-semibold">Monthly hires by department</h3>
          <div className="mt-4">
            <ChartToggle
              id="exec-monthly"
              graph={<ColumnChart labels={months.map(monthLabel)} series={series} />}
              table={
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr><th>Month</th>{series.map((s) => <th key={s.name} className="text-right">{s.name}</th>)}</tr>
                    </thead>
                    <tbody>
                      {months.map((m, i) => (
                        <tr key={m}>
                          <td>{monthLabel(m)}</td>
                          {series.map((s) => <td key={s.name} className="text-right tabular-nums">{s.values[i]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            />
          </div>
        </section>
      </div>
    </div>
  );
}
