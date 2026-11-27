import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { jobsByStage } from "@/lib/dashboard-data";
import { WORKPLACE_TYPES } from "@/lib/job-fields";

export const metadata = { title: "Jobs dashboard" };

export default async function JobsDashboard({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; mine?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = sp.status === "all" ? "all" : "open";
  const q = sp.q?.trim().slice(0, 100) ?? "";
  const mine = sp.mine === "1";
  const all = await jobsByStage(user, status, mine);
  const rows = q ? all.filter((j) => `${j.title} ${j.department ?? ""} ${j.location ?? ""}`.toLowerCase().includes(q.toLowerCase())) : all;

  return (
    <div className="space-y-5">
      <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.04em]">Jobs dashboard</h1>
      <form className="dashboard-card flex flex-wrap items-end gap-3 !py-4" role="search" aria-label="Filter jobs">
        <div className="min-w-56 flex-1">
          <label htmlFor="jobs-q" className="label">Search</label>
          <input id="jobs-q" name="q" defaultValue={q} placeholder="Job title, department, or location" className="input" />
        </div>
        <div>
          <label htmlFor="jobs-status" className="label">Job status</label>
          <select id="jobs-status" name="status" defaultValue={status} className="input">
            <option value="open">Open</option>
            <option value="all">All</option>
          </select>
        </div>
        <div>
          <label htmlFor="jobs-mine" className="label">Jobs</label>
          <select id="jobs-mine" name="mine" defaultValue={mine ? "1" : ""} className="input">
            <option value="">All jobs</option>
            <option value="1">My jobs</option>
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">Apply</button>
      </form>

      {rows.length === 0 ? (
        <p className="dashboard-card muted text-sm">No jobs match.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((job) => {
            const cols = [
              { key: "total", label: "Candidates", n: job.active, href: `/jobs/${job.id}?view=board` },
              ...job.stages.map((s) => ({
                key: s.id,
                label: s.name,
                n: s.active,
                href: `/candidates?${new URLSearchParams({ job: job.id, stage: s.name, status: "active" })}`,
              })),
              { key: "hired", label: "Hired", n: job.hired, href: `/candidates?${new URLSearchParams({ job: job.id, status: "hired" })}` },
              { key: "archived", label: "Archived", n: job.archived, href: `/jobs/${job.id}?view=archived` },
            ];
            return (
              <li key={job.id} className="dashboard-card !p-0 transition-shadow hover:shadow-[0_0_0_2px_#b9dcc8]">
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4">
                  <div className="min-w-0">
                    <Link href={`/jobs/${job.id}`} className="text-[15px] font-semibold hover:underline">{job.title}</Link>
                    <div className="muted text-xs">
                      {[job.location, job.workplaceType ? WORKPLACE_TYPES[job.workplaceType as keyof typeof WORKPLACE_TYPES] : null, job.department].filter(Boolean).join(" | ") || "No location"}
                    </div>
                  </div>
                  {job.status !== "open" && <span className={`data-status data-status-${job.status}`}>{job.status}</span>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] table-fixed border-t border-[var(--border)] text-center text-xs">
                    <thead>
                      <tr className="bg-[#f7faf7] text-[#5d6f63]">
                        {cols.map((c) => <th key={c.key} scope="col" className="truncate px-2 py-2 font-medium" title={c.label}>{c.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {cols.map((c) => (
                          <td key={c.key} className="px-2 py-2.5">
                            <Link href={c.href} className={`font-mono text-sm tabular-nums hover:underline ${c.n ? "font-semibold text-[var(--text)]" : "text-[#9aa89e]"}`} aria-label={`${c.label}: ${c.n}`}>
                              {c.n}
                            </Link>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
