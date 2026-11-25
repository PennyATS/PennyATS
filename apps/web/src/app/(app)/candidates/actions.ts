"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applications, jobs, notes, scorecards } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { aiErrorMessage, allowAiCall, getAiFor } from "@/lib/ai";
import { feedbackPrompt } from "@/lib/ai-rules";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  addApplication,
  canSeeCandidate,
  getApplicationFor,
  logActivity,
  moveApplication,
} from "@/lib/hiring";
import { canManageHiring, canManageUsers } from "@/lib/permissions";
import { deleteCandidates } from "@/lib/privacy";
import { extensionOf, storage } from "@/lib/storage";
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
  redirect(`/candidates/${result.candidateId}`);
}

function refresh(candidateId: string, jobId: string) {
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/jobs/${jobId}`);
}

export async function moveStageAction(applicationId: string, form: FormData): Promise<void> {
  const user = await requireUser(canManageHiring);
  const moved = await moveApplication(user, applicationId, field(form, "stageId", 64) ?? "");
  if (moved) refresh(moved.candidateId, moved.jobId);
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
  const reason = status === "active" ? null : field(form, "reason", 500);

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
