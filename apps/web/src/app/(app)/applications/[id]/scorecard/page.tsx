import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { candidates } from "@pennyats/db";
import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadScorecardContext } from "@/lib/scorecard-context";
import { RATING_LABELS, RECOMMENDATIONS, RECOMMENDATION_LABELS } from "@/lib/scorecards";
import { submitScorecardAction } from "./actions";

export default async function ScorecardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ interview?: string }>;
}) {
  const { id } = await params;
  const interviewId = (await searchParams).interview ?? null;
  const user = await requireUser();
  const ctx = await loadScorecardContext(user, id, interviewId);
  if (!ctx) notFound();
  const { app, job, interview, stageName, existing } = ctx;
  // The form's field names follow this list's order; the action uses the same list.
  const attributes = ctx.attributes;
  const [candidate] = await db()
    .select({ name: candidates.fullName })
    .from(candidates)
    .where(eq(candidates.id, app.candidateId));

  return (
    <>
      <p className="text-sm">
        <Link href={`/candidates/${app.candidateId}`} className="link">
          Back to {candidate.name}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {existing ? "Edit scorecard" : "Scorecard"}: {candidate.name}
      </h1>
      <p className="muted mb-6 mt-1 text-sm">
        {job.title} · {stageName}
        {interview && ` · ${interview.name}`}
      </p>

      {interview?.instructions && (
        <section className="card mb-6 max-w-2xl" aria-labelledby="instructions-title">
          <h2 id="instructions-title" className="card-title">
            Interviewer instructions
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{interview.instructions}</p>
        </section>
      )}

      <ActionForm
        resetKey={existing?.updatedAt.toISOString() ?? "new"}
        action={submitScorecardAction.bind(null, app.id, interview?.id ?? null)}
        className="card max-w-2xl space-y-6"
      >
        {attributes.length > 0 && (
          <div className="space-y-4">
            <p className="muted text-sm">Rate what you assessed. Leave the rest as not assessed.</p>
            {attributes.map((name, i) => (
              <fieldset key={name}>
                <legend className="label">{name}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`rating-${i}`} value="" defaultChecked={!existing?.ratings[name]} />
                    <span className="muted">Not assessed</span>
                  </label>
                  {[1, 2, 3, 4].map((n) => (
                    <label key={n} className="flex items-center gap-1">
                      <input type="radio" name={`rating-${i}`} value={n} defaultChecked={existing?.ratings[name] === n} />
                      {n} {RATING_LABELS[n]}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}

        <fieldset>
          <legend className="label">Overall recommendation *</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {RECOMMENDATIONS.map((r) => (
              <label key={r} className="flex items-center gap-1">
                <input type="radio" name="recommendation" value={r} required defaultChecked={existing?.recommendation === r} />
                {RECOMMENDATION_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="label" htmlFor="summary">
            Summary
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={6}
            className="input"
            placeholder="What stood out, and why you landed on this recommendation."
            defaultValue={existing?.summary ?? ""}
          />
        </div>

        <SubmitButton>{existing ? "Update scorecard" : "Submit scorecard"}</SubmitButton>
      </ActionForm>
    </>
  );
}
