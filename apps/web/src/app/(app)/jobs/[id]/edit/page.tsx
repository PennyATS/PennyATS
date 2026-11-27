import Link from "next/link";
import { asc, count, eq, inArray } from "drizzle-orm";
import { roleLabel, TEAM_ROLE_PRESETS, TEAM_ROLES, can } from "@/lib/permissions";
import { applications, jobTeam, users, roles } from "@pennyats/db";
import { requireJobAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import {
  addStageAction,
  addTeamMemberAction,
  deleteStageAction,
  moveStageAction,
  removeTeamMemberAction,
  setTeamRoleAction,
  renameStageAction,
  updateAttributesAction,
  updateJobAction,
} from "../../actions";
import { ActionForm, SubmitButton } from "@/components/form";
import { MAX_ATTRIBUTES } from "@/lib/scorecards";
import { JobForm } from "../../job-form";

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireJobAccess("jobs.edit", id);
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
      .select({ id: users.id, name: users.name, role: roles.key, teamRole: jobTeam.teamRole })
      .from(jobTeam)
      .innerJoin(users, eq(users.id, jobTeam.userId))
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(jobTeam.jobId, job.id))
      .orderBy(asc(users.name)),
    db().select({ id: users.id, name: users.name, role: roles.key, active: users.active }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).innerJoin(roles, eq(roles.id, users.roleId)).orderBy(asc(users.name)),
  ]);
  const inStage = new Map(stageCounts.map((r) => [r.stageId, r.n]));
  const teamIds = new Set(team.map((t) => t.id));
  const addable = everyone.filter((u) => !teamIds.has(u.id));

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold tracking-tight">Edit job</h2>
      <JobForm
        pay={can(user, "jobs.edit_compensation", { jobId: job.id }) ? "edit" : can(user, "jobs.view_compensation", { jobId: job.id }) ? "view" : "hidden"}
        version={job.updatedAt.toISOString()}
        action={updateJobAction.bind(null, job.id)}
        job={job}
        people={everyone.filter((u) => u.active || u.id === job.hiringManagerId || u.id === job.recruiterId)}
        submitLabel="Save"
      />

      <section className="card mt-6" aria-labelledby="scorecard-title">
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

      <section className="card mt-6" aria-labelledby="stages-title">
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

      <section className="card mt-6" aria-labelledby="team-title">
        <div className="card-header">
          <h2 id="team-title" className="card-title">Hiring team</h2>
          <p className="card-note">
            Each member&apos;s team role adds permissions on this job only, on top of their own role. Hiring Managers and
            Interviewers only see jobs they are on{job.confidential ? "; this confidential job is hidden from everyone not listed here" : ""}.
          </p>
        </div>
        {team.length === 0 ? (
          <p className="muted text-sm">No one yet.</p>
        ) : (
          <ul className="card-rows text-sm">
            {team.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {member.name} <span className="muted">· {roleLabel(member.role)}</span>
                </span>
                <form action={setTeamRoleAction.bind(null, job.id, member.id)} className="flex items-center gap-2" key={member.teamRole}>
                  <label className="sr-only" htmlFor={`team-role-${member.id}`}>Team role for {member.name}</label>
                  <select id={`team-role-${member.id}`} name="teamRole" defaultValue={member.teamRole} className="input">
                    {TEAM_ROLES.map((r) => (
                      <option key={r} value={r}>{TEAM_ROLE_PRESETS[r].name}</option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-secondary">Save</button>
                </form>
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
            <select name="teamRole" aria-label="Team role" defaultValue="interviewer" className="input">
              {TEAM_ROLES.map((r) => (
                <option key={r} value={r}>{TEAM_ROLE_PRESETS[r].name}</option>
              ))}
            </select>
            <button type="submit" className="btn btn-secondary">
              Add to team
            </button>
          </form>
        )}
        <dl className="mt-4 space-y-1 border-t pt-4 text-xs" style={{ borderColor: "var(--border)" }}>
          {TEAM_ROLES.map((r) => (
            <div key={r}>
              <dt className="inline font-medium">{TEAM_ROLE_PRESETS[r].name}:</dt>{" "}
              <dd className="muted inline">{TEAM_ROLE_PRESETS[r].description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
