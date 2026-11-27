"use server";

import { and, eq, inArray, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  applications,
  interviewTemplateInterviewers,
  interviewTemplates,
  jobTeam,
  jobs,
  users,
} from "@pennyats/db";
import type { FormState } from "@/components/form";
import { requireUser, requireJobAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { createStageInterviews } from "@/lib/hiring";
import { parseTemplateForm, type TemplateInput } from "@/lib/interviews";
import { isUuid } from "@/lib/validation";

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** Checks the stage, attributes and interviewers against this job. Returns an error or the cleaned input. */
async function validate(jobId: string, input: TemplateInput): Promise<{ error: string } | { value: TemplateInput }> {
  const [job] = await db()
    .select({ attributes: jobs.scorecardAttributes })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!job) return { error: "Job not found." };
  if (!(await db().query.stages.findFirst({ where: (s, { and, eq }) => and(eq(s.id, input.stageId), eq(s.jobId, jobId)) }))) {
    return { error: "That stage isn't part of this job." };
  }
  const valid = new Set(job.attributes);
  const attributes = input.attributes.filter((a) => valid.has(a));
  const people = input.interviewerIds.length
    ? await db()
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, input.interviewerIds), eq(users.active, true)))
    : [];
  return { value: { ...input, attributes, interviewerIds: people.map((p) => p.id) } };
}

/** Interviewers only see jobs they're on, so anyone assigned to a planned interview joins the hiring team. */
async function addToTeam(tx: Tx, jobId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  await tx
    .insert(jobTeam)
    .values(userIds.map((userId) => ({ jobId, userId })))
    .onConflictDoNothing();
}

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}/interview-plan`);
  revalidatePath(`/jobs/${jobId}`);
}

export async function createTemplateAction(jobId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireJobAccess("interviews.plan", jobId);
  if (!isUuid(jobId)) return { error: "Job not found." };
  const parsed = parseTemplateForm(form);
  if (!parsed.ok) return { error: parsed.error };
  const checked = await validate(jobId, parsed.value);
  if ("error" in checked) return checked;
  const t = checked.value;
  const applyToCurrent = form.get("applyToCurrent") === "on";

  const added = await db().transaction(async (tx) => {
    const [{ top }] = await tx
      .select({ top: max(interviewTemplates.position) })
      .from(interviewTemplates)
      .where(eq(interviewTemplates.stageId, t.stageId));
    const [template] = await tx
      .insert(interviewTemplates)
      .values({
        jobId,
        stageId: t.stageId,
        name: t.name,
        durationMinutes: t.durationMinutes,
        attributes: t.attributes,
        instructions: t.instructions,
        position: (top ?? -1) + 1,
      })
      .returning({ id: interviewTemplates.id });
    if (t.interviewerIds.length) {
      await tx
        .insert(interviewTemplateInterviewers)
        .values(t.interviewerIds.map((userId) => ({ templateId: template.id, userId })));
    }
    await addToTeam(tx, jobId, t.interviewerIds);

    // Optionally give candidates already in this stage the new interview too.
    if (!applyToCurrent) return 0;
    const current = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.stageId, t.stageId), eq(applications.status, "active")));
    let n = 0;
    for (const app of current) n += await createStageInterviews(tx, app.id, t.stageId);
    return n;
  });

  refresh(jobId);
  return {
    message: applyToCurrent
      ? `Interview added to the plan and to ${added} candidate${added === 1 ? "" : "s"} already in that stage.`
      : "Interview added to the plan. Candidates get it when they enter the stage.",
  };
}

/** Edits the plan only. Interviews already created for candidates keep their details. */
export async function updateTemplateAction(
  jobId: string,
  templateId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await requireJobAccess("interviews.plan", jobId);
  if (!isUuid(jobId) || !isUuid(templateId)) return { error: "Interview not found." };
  const parsed = parseTemplateForm(form);
  if (!parsed.ok) return { error: parsed.error };
  const checked = await validate(jobId, parsed.value);
  if ("error" in checked) return checked;
  const t = checked.value;

  const found = await db().transaction(async (tx) => {
    const [row] = await tx
      .update(interviewTemplates)
      .set({
        stageId: t.stageId,
        name: t.name,
        durationMinutes: t.durationMinutes,
        attributes: t.attributes,
        instructions: t.instructions,
      })
      .where(and(eq(interviewTemplates.id, templateId), eq(interviewTemplates.jobId, jobId)))
      .returning({ id: interviewTemplates.id });
    if (!row) return false;
    await tx.delete(interviewTemplateInterviewers).where(eq(interviewTemplateInterviewers.templateId, templateId));
    if (t.interviewerIds.length) {
      await tx
        .insert(interviewTemplateInterviewers)
        .values(t.interviewerIds.map((userId) => ({ templateId, userId })));
    }
    await addToTeam(tx, jobId, t.interviewerIds);
    return true;
  });
  if (!found) return { error: "Interview not found." };
  refresh(jobId);
  redirect(`/jobs/${jobId}/interview-plan?saved=1`);
}

/** Removes an interview from the plan. Candidates' existing interviews and scorecards stay. */
export async function deleteTemplateAction(jobId: string, templateId: string): Promise<void> {
  await requireJobAccess("interviews.plan", jobId);
  if (!isUuid(jobId) || !isUuid(templateId)) return;
  await db()
    .delete(interviewTemplates)
    .where(and(eq(interviewTemplates.id, templateId), eq(interviewTemplates.jobId, jobId)));
  refresh(jobId);
}
