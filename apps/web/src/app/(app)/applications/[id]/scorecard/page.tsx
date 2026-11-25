import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { candidates, jobs, scorecards } from "@pennyats/db";
import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentStageName, getApplicationFor } from "@/lib/hiring";
import { RATING_LABELS, RECOMMENDATIONS, RECOMMENDATION_LABELS } from "@/lib/scorecards";
import { isUuid } from "@/lib/validation";
import { submitScorecardAction } from "./actions";

export default async function ScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const app = isUuid(id) ? await getApplicationFor(user, id) : null;
  if (!app) notFound();

  const stageName = await currentStageName(app.stageId);
  const [[candidate], [job], [existing]] = await Promise.all([
    db().select({ name: candidates.fullName }).from(candidates).where(eq(candidates.id, app.candidateId)),
    db().select({ title: jobs.title, attributes: jobs.scorecardAttributes }).from(jobs).where(eq(jobs.id, app.jobId)),
    db()
      .select()
      .from(scorecards)
      .where(
        and(
          eq(scorecards.applicationId, app.id),
          eq(scorecards.authorId, user.id),
          eq(scorecards.stageName, stageName),
        ),
      ),
  ]);

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
      </p>

      {/* Keyed so the form shows saved values after React resets it post-submit. */}
      <ActionForm
        key={existing?.updatedAt.toISOString() ?? "new"}
        action={submitScorecardAction.bind(null, app.id)}
        className="card max-w-2xl space-y-6"
      >
        {job.attributes.length > 0 && (
          <div className="space-y-4">
            <p className="muted text-sm">Rate what you assessed. Leave the rest as not assessed.</p>
            {job.attributes.map((name, i) => (
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
