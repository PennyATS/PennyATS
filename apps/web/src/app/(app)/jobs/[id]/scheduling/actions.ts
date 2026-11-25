"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { applications, emailTemplates, interviews, stageSchedulingSettings, stages } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageHiring } from "@/lib/permissions";
import { queueInterviewReminders } from "@/lib/scheduling-delivery";
import { isUuid } from "@/lib/validation";

export async function saveStageSchedulingAction(jobId: string, stageId: string,
  _: FormState, form: FormData): Promise<FormState> {
  await requireUser(canManageHiring);
  if (!isUuid(jobId) || !isUuid(stageId)) return { error: "Stage not found." };
  const [stage] = await db().select({ jobId: stages.jobId }).from(stages).where(eq(stages.id, stageId));
  if (!stage || stage.jobId !== jobId) return { error: "Stage not found." };
  const mode = form.get("autoLinkMode");
  if (mode !== "none" && mode !== "booking" && mode !== "availability") return { error: "Choose a scheduling mode." };
  const raw = String(form.get("reminderMinutes") ?? "").trim();
  const reminderMinutes = raw ? Number(raw) : null;
  if (reminderMinutes !== null && (!Number.isInteger(reminderMinutes) || reminderMinutes < 5 || reminderMinutes > 10080)) {
    return { error: "Reminder timing must be between 5 minutes and 7 days." };
  }
  const templateRaw = String(form.get("emailTemplateId") ?? "");
  let emailTemplateId: string | null = null;
  if (templateRaw) {
    if (!isUuid(templateRaw)) return { error: "Template not found." };
    const [template] = await db().select({ id: emailTemplates.id }).from(emailTemplates).where(eq(emailTemplates.id, templateRaw));
    if (!template) return { error: "Template not found." };
    emailTemplateId = template.id;
  }
  await db().insert(stageSchedulingSettings).values({ stageId, autoLinkMode: mode,
    reminderMinutes, emailTemplateId }).onConflictDoUpdate({ target: stageSchedulingSettings.stageId,
    set: { autoLinkMode: mode, reminderMinutes, emailTemplateId, updatedAt: new Date() } });
  const current = await db().select({ id: interviews.id }).from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .where(and(eq(interviews.stageId, stageId), eq(applications.status, "active")));
  for (const interview of current) await queueInterviewReminders(interview.id);
  revalidatePath(`/jobs/${jobId}/scheduling`);
  return { message: "Stage settings saved." };
}
