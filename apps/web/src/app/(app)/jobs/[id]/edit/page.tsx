import Link from "next/link";
import { asc, count, eq, inArray } from "drizzle-orm";
import { applications, jobTeam, users } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { canManageHiring } from "@/lib/permissions";
import {
  addStageAction,
  addTeamMemberAction,
  deleteStageAction,
  moveStageAction,
  removeTeamMemberAction,
  renameStageAction,
  updateAttributesAction,
  updateJobAction,
} from "../../actions";
import { ActionForm, SubmitButton } from "@/components/form";
import { MAX_ATTRIBUTES } from "@/lib/scorecards";
import { JobForm } from "../../job-form";

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(canManageHiring);
  const { job, stages } = await loadJob(user, id);

  const [stageCounts, team, everyone] = await Promise.all([
    stages.length
      ? db()
          .select({ stageId: applications.stageId, n: count() })
          .from(applications)
          .where(
            inArray(
              applications.stageId,
              stages.map((s) => s.id),
            ),
          )
          .groupBy(applications.stageId)
      : [],
    db()
      .select({ id: users.id, name: users.name, role: users.role })
      .from(jobTeam)
      .innerJoin(users, eq(users.id, jobTeam.userId))
      .where(eq(jobTeam.jobId, job.id))
      .orderBy(asc(users.name)),
    db().select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
  ]);
  const inStage = new Map(stageCounts.map((r) => [r.stageId, r.n]));
  const teamIds = new Set(team.map((t) => t.id));
  const addable = everyone.filter((u) => !teamIds.has(u.id));

  return (
    <>
      <p className="text-sm">
        <Link href={`/jobs/${job.id}`} className="link">
          Back to {job.title}
        </Link>
      </p>
      <h1 className="mb-6 mt-2 text-2xl font-semibold tracking-tight">Edit job</h1>
      <JobForm
        version={job.updatedAt.toISOString()}
        action={updateJobAction.bind(null, job.id)}
        job={job}
        submitLabel="Save"
      />

      <section className="card mt-6 max-w-2xl" aria-labelledby="scorecard-title">
        <div className="card-header">
          <h2 id="scorecard-title" className="card-title">Scorecard</h2>
          <p className="card-note">
            What interviewers rate for this job, one per line (up to {MAX_ATTRIBUTES}). Each is scored 1 to 4, plus an
            overall recommendation.
          </p>
        </div>
        <ActionForm
          resetKey={job.scorecardAttributes.join("|")}
          action={updateAttributesAction.bind(null, job.id)}
          className="space-y-3"
        >
          <label className="label" htmlFor="attributes">
            Attributes
          </label>
          <textarea
            id="attributes"
            name="attributes"
            rows={Math.max(4, job.scorecardAttributes.length + 1)}
            className="input"
            defaultValue={job.scorecardAttributes.join("\n")}
          />
          <SubmitButton variant="secondary">Save attributes</SubmitButton>
        </ActionForm>
      </section>

      <section className="card mt-6 max-w-2xl" aria-labelledby="stages-title">
        <div className="card-header">
          <h2 id="stages-title" className="card-title">Pipeline stages</h2>
          <p className="card-note">
            The order candidates move through. A stage can be deleted once it&apos;s empty. Plan the interviews for each
            stage in the{" "}
            <Link href={`/jobs/${job.id}/interview-plan`} className="link">
              interview plan
            </Link>
            .
          </p>
        </div>
        <ol className="card-rows">
          {stages.map((stage, i) => {
            const n = inStage.get(stage.id) ?? 0;
            return (
              <li key={stage.id} className="flex flex-wrap items-center gap-2">
                <form action={renameStageAction.bind(null, job.id, stage.id)} className="flex min-w-0 flex-1 gap-2">
                  <input
                    key={stage.name}
                    name="name"
                    defaultValue={stage.name}
                    aria-label={`Stage ${i + 1} name`}
                    className="input min-w-0 flex-1"
                    required
                  />
                  <button type="submit" className="btn btn-secondary">
                    Rename
                  </button>
                </form>
                <div className="flex items-center gap-2">
                  <form action={moveStageAction.bind(null, job.id, stage.id, -1)}>
                    <button
                      type="submit"
                      className="btn btn-secondary btn-icon"
                      disabled={i === 0}
                      aria-label={`Move ${stage.name} up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                  </form>
                  <form action={moveStageAction.bind(null, job.id, stage.id, 1)}>
                    <button
                      type="submit"
                      className="btn btn-secondary btn-icon"
                      disabled={i === stages.length - 1}
                      aria-label={`Move ${stage.name} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                  </form>
                  <form action={deleteStageAction.bind(null, job.id, stage.id)}>
                    <button
                      type="submit"
                      className="btn btn-secondary"
                      disabled={n > 0}
                      title={n > 0 ? "Move its candidates to another stage first" : `Delete ${stage.name}`}
                      aria-describedby={n > 0 ? `stage-count-${stage.id}` : undefined}
                    >
                      Delete
                    </button>
                  </form>
                </div>
                {n > 0 && (
                  <p id={`stage-count-${stage.id}`} className="muted w-full text-xs">
                    {n} candidate{n === 1 ? "" : "s"} here, so this stage can&apos;t be deleted yet.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <form
          action={addStageAction.bind(null, job.id)}
          className="mt-4 flex gap-2 border-t pt-4"
          style={{ borderColor: "var(--border)" }}
        >
          <input name="name" placeholder="New stage name" aria-label="New stage name" className="input min-w-0 flex-1" required />
          <button type="submit" className="btn btn-secondary">
            Add stage
          </button>
        </form>
      </section>

      <section className="card mt-6 max-w-2xl" aria-labelledby="team-title">
        <div className="card-header">
          <h2 id="team-title" className="card-title">Hiring team</h2>
          <p className="card-note">Interviewers only see jobs they are on the hiring team for.</p>
        </div>
        {team.length === 0 ? (
          <p className="muted text-sm">No one yet.</p>
        ) : (
          <ul className="card-rows text-sm">
            {team.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3">
                <span>
                  {member.name} <span className="muted capitalize">· {member.role}</span>
                </span>
                <form action={removeTeamMemberAction.bind(null, job.id, member.id)}>
                  <button type="submit" className="btn btn-secondary" aria-label={`Remove ${member.name} from the hiring team`}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {addable.length > 0 && (
          <form
            action={addTeamMemberAction.bind(null, job.id)}
            className="mt-4 flex gap-2 border-t pt-4"
            style={{ borderColor: "var(--border)" }}
          >
            <select name="userId" aria-label="Team member" className="input min-w-0 flex-1">
              {addable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-secondary">
              Add to team
            </button>
          </form>
        )}
      </section>
    </>
  );
}
