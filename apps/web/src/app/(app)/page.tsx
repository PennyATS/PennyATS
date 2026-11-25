import { and, count, eq, inArray } from "drizzle-orm";
import { aiEnabled } from "@pennyats/ai";
import { applications, jobs } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { db } from "@/lib/db";
import { visibleJobIds } from "@/lib/hiring";

export default async function Dashboard() {
  const user = await requireUser();
  const ids = await visibleJobIds(user);
  // Interviewers on no hiring team see zero; an empty IN () isn't valid SQL, so short-circuit.
  const none = ids !== null && ids.length === 0;

  const [[openJobs], [active]] = none
    ? [[{ n: 0 }], [{ n: 0 }]]
    : await Promise.all([
        db()
          .select({ n: count() })
          .from(jobs)
          .where(and(eq(jobs.status, "open"), ids ? inArray(jobs.id, ids) : undefined)),
        db()
          .select({ n: count() })
          .from(applications)
          .where(
            and(eq(applications.status, "active"), ids ? inArray(applications.jobId, ids) : undefined),
          ),
      ]);
  const ai = aiEnabled();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="muted mt-1 text-sm">{BRAND.tagline}</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Open jobs", value: openJobs.n },
          { label: "Active applications", value: active.n },
          { label: "AI features", value: ai ? "On" : "Off" },
        ].map((card) => (
          <div key={card.label} className="card">
            <div className="muted text-sm">{card.label}</div>
            <div className="mt-2 text-3xl font-semibold">{card.value}</div>
          </div>
        ))}
      </div>
      {!ai && (
        <p className="muted mt-6 text-sm">
          AI is off. Set AI_PROVIDER and AI_API_KEY in your environment to turn it on.
        </p>
      )}
    </>
  );
}
