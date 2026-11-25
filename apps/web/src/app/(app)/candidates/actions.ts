"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applications, candidates, emails, emailTemplates, jobs, notes, schedulingDeliveries, scorecards } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { aiErrorMessage, allowAiCall, getAiFor } from "@/lib/ai";
import { feedbackPrompt } from "@/lib/ai-rules";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { prepareTemplateEmail, retryEmail, sendStageEntryEmail } from "@/lib/candidate-email";
import {
  addApplication,
  canSeeCandidate,
  getApplicationFor,
  logActivity,
  moveApplication,
} from "@/lib/hiring";
import { canManageHiring, canManageUsers } from "@/lib/permissions";
import { deleteCandidates } from "@/lib/privacy";
import { queueStageLinkOnEntry, suppressQueuedStageLinks } from "@/lib/scheduling-delivery";
import { smtpConfigured } from "@/lib/smtp";
import { extensionOf, storage } from "@/lib/storage";
import { mergeTags, normalizeTag, parseTags, rejectionReasonText } from "@/lib/candidate-review";
import { checkResume, field, isUuid, parseCandidate } from "@/lib/validation";

/** Recruiter adds someone by hand (sourced, referral, etc.). Email is optional here. */
export async function addCandidateAction(jobId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(canManageHiring);
  if (!isUuid(jobId)) return { error: "Job not found." };
  const [job] = await db().select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId));
  if (!job) return { error: "Job not found." };
  const parsed = parseCandidate(form, { requireEmail: false });
  if (!parsed.ok) return { error: parsed.error };

  let resume: { key: string; name: string } | undefined;
  const file = form.get("resume");
  if (file instanceof File && file.size > 0) {
    const problem = checkResume(file.name, file.size);
    if (problem) return { error: problem };
    const key = await storage.put(new Uint8Array(await file.arrayBuffer()), extensionOf(file.name));
    resume = { key, name: file.name.slice(0, 200) };
  }

  const result = await db().transaction((tx) =>
    addApplication(tx, {
      jobId,
      candidate: { ...parsed.value, source: field(form, "source", 100) ?? "Sourced" },
      resume,
      actorId: user.id,
    }),
  );
  if (!result.created) {
    return { error: "This candidate already has an application for this job." };
  }
  if (result.applicationId) await sendStageEntryEmail(result.applicationId, null, user.id);
  redirect(`/candidates/${result.candidateId}`);
}

function refresh(candidateId: string, jobId: string) {
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/jobs/${jobId}`);
}

export async function moveStageAction(applicationId: string, form: FormData): Promise<void> {
  const user = await requireUser(canManageHiring);
  const moved = await moveApplication(user, applicationId, field(form, "stageId", 64) ?? "");
  if (moved) {
    if (moved.stageId) await suppressQueuedStageLinks(applicationId, moved.stageId);
    const stageId = field(form, "stageId", 64) ?? "";
    await queueStageLinkOnEntry(applicationId, stageId);
    await sendStageEntryEmail(applicationId, stageId, user.id);
    refresh(moved.candidateId, moved.jobId);
  }
}

/** Explicit retry only after SMTP reports failure; never replay an uncertain sending claim. */
export async function retrySchedulingDeliveryAction(deliveryId: string): Promise<void> {
  const user = await requireUser(canManageHiring);
  if (!isUuid(deliveryId)) return;
  const [delivery] = await db().select().from(schedulingDeliveries)
    .where(eq(schedulingDeliveries.id, deliveryId));
  if (!delivery || delivery.status !== "failed" ||
    delivery.lastError !== "SMTP did not confirm delivery. Check the mail server before retrying.") return;
  const app = await getApplicationFor(user, delivery.applicationId);
  if (!app) return;
  await db().update(schedulingDeliveries).set({ status: "queued", lastError: null, updatedAt: new Date() })
    .where(eq(schedulingDeliveries.id, deliveryId));
  refresh(app.candidateId, app.jobId);
}

export async function sendCandidateEmailAction(candidateId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(canManageHiring);
  const applicationId = String(form.get("applicationId") ?? "");
  const templateId = String(form.get("templateId") ?? "");
  if (!isUuid(candidateId) || !isUuid(applicationId) || !isUuid(templateId)) return { error: "Choose a job and template." };
  const app = await getApplicationFor(user, applicationId);
  if (!app || app.candidateId !== candidateId) return { error: "Application not found." };
  if (!smtpConfigured()) return { error: "Configure SMTP before sending candidate email." };
  const attempt = await prepareTemplateEmail({ applicationId, templateId, actorId: user.id });
  revalidatePath(`/candidates/${candidateId}`);
  if (attempt.status === "skipped") return { error: attempt.error };
  if (attempt.status !== "sending") return { error: "Template not found." };
  return (await attempt.deliver()) === "sent"
    ? { message: "Email sent and recorded on the candidate timeline." }
    : { error: "SMTP did not confirm delivery. The failed attempt is on the timeline; you can resend it." };
}

/** Resend an email that failed or was skipped (for example, before SMTP was set up). */
export async function resendEmailAction(emailId: string, candidateId: string): Promise<void> {
  const user = await requireUser(canManageHiring);
  if (!isUuid(emailId) || !isUuid(candidateId)) return;
  const [row] = await db().select({ applicationId: emails.applicationId, candidateId: emails.candidateId })
    .from(emails).where(eq(emails.id, emailId));
  if (!row || row.candidateId !== candidateId || !row.applicationId) return;
  if (!(await getApplicationFor(user, row.applicationId))) return;
  await retryEmail(emailId);
  revalidatePath(`/candidates/${candidateId}`);
}

/** Hire, reject, withdraw, or reopen an application. */
export async function setStatusAction(
  applicationId: string,
  status: "hired" | "rejected" | "withdrawn" | "active",
  form: FormData,
): Promise<void> {
  const user = await requireUser(canManageHiring);
  const app = await getApplicationFor(user, applicationId);
  if (!app || app.status === status) return;
  // Rejections use the standard list, with an optional note; withdrawals keep a free-text note.
  const reason =
    status === "rejected"
      ? rejectionReasonText(field(form, "reason", 100), field(form, "note", 400))
      : status === "active"
        ? null
        : field(form, "reason", 500);
  if (status === "rejected" && !reason) return;

  await db().transaction(async (tx) => {
    await tx
      .update(applications)
      .set({ status, rejectionReason: status === "rejected" ? reason : null })
      .where(eq(applications.id, app.id));
    await logActivity(tx, {
      applicationId: app.id,
      actorId: user.id,
      type: status === "active" ? "reopened" : status,
      data: reason ? { reason } : {},
    });
  });
  refresh(app.candidateId, app.jobId);
}

/** Add tags ("#swe, #bayarea"). Recruiters and admins only. */
export async function addTagsAction(candidateId: string, form: FormData): Promise<void> {
  await requireUser(canManageHiring);
  if (!isUuid(candidateId)) return;
  const added = parseTags(field(form, "tags", 500) ?? "");
  if (added.length === 0) return;
  const [row] = await db().select({ tags: candidates.tags }).from(candidates).where(eq(candidates.id, candidateId));
  if (!row) return;
  await db().update(candidates).set({ tags: mergeTags(row.tags, added) }).where(eq(candidates.id, candidateId));
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
}

export async function removeTagAction(candidateId: string, tag: string): Promise<void> {
  await requireUser(canManageHiring);
  const normalized = normalizeTag(tag);
  if (!isUuid(candidateId) || !normalized) return;
  const [row] = await db().select({ tags: candidates.tags }).from(candidates).where(eq(candidates.id, candidateId));
  if (!row) return;
  await db().update(candidates).set({ tags: row.tags.filter((t) => normalizeTag(t) !== normalized) }).where(eq(candidates.id, candidateId));
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/candidates");
}

/** Upload or replace a resume from the profile. Plain-text files also fill the searchable resume text. */
export async function uploadResumeAction(candidateId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireUser(canManageHiring);
  if (!isUuid(candidateId)) return { error: "Candidate not found." };
  const file = form.get("resume");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  const problem = checkResume(file.name, file.size);
  if (problem) return { error: problem };
  const [row] = await db().select({ key: candidates.resumeKey }).from(candidates).where(eq(candidates.id, candidateId));
  if (!row) return { error: "Candidate not found." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extensionOf(file.name);
  const key = await storage.put(bytes, ext);
  const text = ext === ".txt" ? new TextDecoder().decode(bytes).slice(0, 100_000) : undefined;
  await db()
    .update(candidates)
    .set({ resumeKey: key, resumeName: file.name.slice(0, 200), ...(text !== undefined ? { resumeText: text } : {}) })
    .where(eq(candidates.id, candidateId));
  if (row.key) await storage.delete(row.key).catch(() => {});
  revalidatePath(`/candidates/${candidateId}`);
  return { message: "Resume saved." };
}

/** Anyone who can see the candidate can add a note, interviewers included. */
export async function addNoteAction(candidateId: string, form: FormData): Promise<void> {
  const user = await requireUser();
  const body = field(form, "body", 10_000);
  if (!body || !isUuid(candidateId)) return;
  if (!(await canSeeCandidate(user, candidateId))) return;
  await db().insert(notes).values({ candidateId, authorId: user.id, body });
  revalidatePath(`/candidates/${candidateId}`);
}

/** Permanently delete a candidate, e.g. for a deletion request. Admin only; needs the confirm box. */
export async function deleteCandidateAction(candidateId: string, _: FormState, form: FormData): Promise<FormState> {
  const admin = await requireUser(canManageUsers);
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm permanent deletion." };
  if (!isUuid(candidateId)) return { error: "Candidate not found." };
  const count = await deleteCandidates([candidateId], {
    actorId: admin.id,
    reason: field(form, "reason", 300),
    action: "candidate_deleted",
  });
  if (count === 0) return { error: "Candidate not found. They may already have been deleted." };
  revalidatePath("/candidates");
  redirect("/candidates?deleted=1");
}

/** AI summary of the scorecards on one application. Recruiters and admins only; not saved. */
export async function summarizeFeedbackAction(applicationId: string): Promise<{ text: string } | { error: string }> {
  const user = await requireUser(canManageHiring);
  const ai = await getAiFor("feedbackSummaries");
  if (!ai) return { error: "AI feedback summaries are turned off." };
  const app = isUuid(applicationId) ? await getApplicationFor(user, applicationId) : null;
  if (!app) return { error: "Application not found." };

  const [cards, [job]] = await Promise.all([
    db()
      .select({
        stageName: scorecards.stageName,
        recommendation: scorecards.recommendation,
        ratings: scorecards.ratings,
        summary: scorecards.summary,
      })
      .from(scorecards)
      .where(eq(scorecards.applicationId, app.id))
      .orderBy(asc(scorecards.createdAt)),
    db().select({ title: jobs.title }).from(jobs).where(eq(jobs.id, app.jobId)),
  ]);
  if (cards.length < 2) return { error: "Summaries need at least two scorecards." };
  if (!allowAiCall(user.id)) return { error: "Too many AI requests. Try again in an hour." };

  try {
    // Interviewers are labeled by number and the candidate isn't named; see feedbackPrompt.
    const text = await ai.complete(feedbackPrompt(job?.title ?? "this role", cards));
    return { text: text.trim() };
  } catch (err) {
    return { error: aiErrorMessage(err) };
  }
}
