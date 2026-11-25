import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { interviewTemplateInterviewers, interviewTemplates, users } from "@pennyats/db";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadJob } from "@/lib/loaders";
import { canManageHiring } from "@/lib/permissions";
import { isUuid } from "@/lib/validation";
import { createTemplateAction, deleteTemplateAction, updateTemplateAction } from "./actions";

export default async function InterviewPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; saved?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(canManageHiring);
  const { job, stages } = await loadJob(user, id);

  const templates = await db()
    .select()
    .from(interviewTemplates)
    .where(eq(interviewTemplates.jobId, job.id))
    .orderBy(asc(interviewTemplates.position), asc(interviewTemplates.createdAt));
  const [assigned, people] = await Promise.all([
    templates.length
      ? db()
          .select({ templateId: interviewTemplateInterviewers.templateId, userId: users.id, name: users.name })
          .from(interviewTemplateInterviewers)
          .innerJoin(users, eq(users.id, interviewTemplateInterviewers.userId))
          .where(inArray(interviewTemplateInterviewers.templateId, templates.map((t) => t.id)))
      : [],
    db()
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name)),
  ]);

  const editing = sp.edit && isUuid(sp.edit) ? templates.find((t) => t.id === sp.edit) : undefined;
  const editingIds = new Set(assigned.filter((a) => a.templateId === editing?.id).map((a) => a.userId));

  return (
    <>
      <p className="text-sm">
        <Link href={`/jobs/${job.id}`} className="link">
          Back to {job.title}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Interview plan</h1>
      <p className="muted mt-1 max-w-2xl text-sm">
        The interviews for each stage of this job. When a candidate enters a stage, its interviews are created for them
        with the interviewers below. Changing the plan doesn&apos;t change interviews candidates already have.
      </p>
      {sp.saved && (
        <p role="status" className="mt-3 text-sm">
          Saved.
        </p>
      )}

      <div className="mt-6 max-w-3xl space-y-6">
        {stages.map((stage) => {
          const planned = templates.filter((t) => t.stageId === stage.id);
          return (
            <section key={stage.id} className="card" aria-labelledby={`stage-${stage.id}`}>
              <div className="card-header">
                <h2 id={`stage-${stage.id}`} className="card-title">
                  {stage.name}
                </h2>
                {planned.length === 0 && <p className="card-note">No interviews planned for this stage.</p>}
              </div>
              {planned.length > 0 && (
                <ul className="card-rows text-sm">
                  {planned.map((t) => {
                    const who = assigned.filter((a) => a.templateId === t.id).map((a) => a.name);
                    return (
                      <li key={t.id} className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {t.name} <span className="muted font-normal">· {t.durationMinutes} min</span>
                          </p>
                          <p className="muted">
                            {who.length ? `Interviewers: ${who.join(", ")}` : "No default interviewers"}
                            {" · "}
                            {t.attributes.length ? `Covers: ${t.attributes.join(", ")}` : "Covers all scorecard attributes"}
                          </p>
                          {t.instructions && <p className="mt-1 whitespace-pre-wrap">{t.instructions}</p>}
                        </div>
                        <div className="flex gap-2">
                          <Link href={`/jobs/${job.id}/interview-plan?edit=${t.id}#plan-form`} className="btn btn-secondary">
                            Edit
                          </Link>
                          <form action={deleteTemplateAction.bind(null, job.id, t.id)}>
                            <button type="submit" className="btn btn-secondary" aria-label={`Remove ${t.name} from the plan`}>
                              Remove
                            </button>
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        <section id="plan-form" className="card" aria-labelledby="plan-form-title">
          <div className="card-header">
            <h2 id="plan-form-title" className="card-title">
              {editing ? `Edit ${editing.name}` : "Add an interview"}
            </h2>
            {editing && (
              <p className="card-note">
                <Link href={`/jobs/${job.id}/interview-plan`} className="link">
                  Cancel editing
                </Link>
              </p>
            )}
          </div>
          {stages.length === 0 ? (
            <p className="muted text-sm">Add pipeline stages to this job first.</p>
          ) : (
            <ActionForm
              action={editing ? updateTemplateAction.bind(null, job.id, editing.id) : createTemplateAction.bind(null, job.id)}
              resetKey={editing?.id ?? "new"}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
                <div>
                  <label className="label" htmlFor="stageId">
                    Stage
                  </label>
                  <select id="stageId" name="stageId" className="input" defaultValue={editing?.stageId ?? stages[0].id}>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Field label="Interview name" name="name" required defaultValue={editing?.name} placeholder="e.g. System design" />
                <Field
                  label="Minutes"
                  name="durationMinutes"
                  type="number"
                  required
                  defaultValue={String(editing?.durationMinutes ?? 45)}
                />
              </div>

              <fieldset>
                <legend className="label">Interviewers</legend>
                <p className="muted mb-2 text-xs">Anyone picked here is added to this job&apos;s hiring team so they can see it.</p>
                <div className="grid gap-1 text-sm sm:grid-cols-2">
                  {people.map((p) => (
                    <label key={p.id} className="flex items-center gap-2">
                      <input type="checkbox" name="interviewerIds" value={p.id} defaultChecked={editingIds.has(p.id)} />
                      {p.name} <span className="muted capitalize">· {p.role}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {job.scorecardAttributes.length > 0 && (
                <fieldset>
                  <legend className="label">What this interview covers</legend>
                  <p className="muted mb-2 text-xs">Its scorecard asks only about these. Leave all unticked to cover everything.</p>
                  <div className="grid gap-1 text-sm sm:grid-cols-2">
                    {job.scorecardAttributes.map((a) => (
                      <label key={a} className="flex items-center gap-2">
                        <input type="checkbox" name="attributes" value={a} defaultChecked={editing?.attributes.includes(a)} />
                        {a}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <div>
                <label className="label" htmlFor="instructions">
                  Instructions for interviewers
                </label>
                <textarea
                  id="instructions"
                  name="instructions"
                  rows={4}
                  className="input"
                  defaultValue={editing?.instructions ?? ""}
                  placeholder="What to cover, example questions, what a strong answer looks like."
                />
              </div>

              {!editing && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="applyToCurrent" />
                  Also add it to candidates already in this stage
                </label>
              )}
              <SubmitButton>{editing ? "Save interview" : "Add to plan"}</SubmitButton>
            </ActionForm>
          )}
        </section>
      </div>
    </>
  );
}
