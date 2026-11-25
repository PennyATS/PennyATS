"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { interviewInterviewers, interviews, jobTeam, users } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { requireUser, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createStageInterviews, currentStageName, getApplicationFor, logActivity } from "@/lib/hiring";
import { parseScheduledAt } from "@/lib/interviews";
import { canManageHiring } from "@/lib/permissions";
import { field, isUuid } from "@/lib/validation";

/** Load an interview the user may manage, with its application. */
async function loadForManager(user: SessionUser, interviewId: string) {
  if (!isUuid(interviewId)) return null;
  const [row] = await db().select().from(interviews).where(eq(interviews.id, interviewId));
  if (!row) return null;
  const app = await getApplicationFor(user, row.applicationId);
  return app ? { interview: row, app } : null;
}

function refresh(candidateId: string, jobId: string) {
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/jobs/${jobId}`);
}

/** Only active users can be assigned; they join the job's hiring team so they can see it. */
async function validInterviewers(jobId: string, form: FormData): Promise<string[]> {
  const ids = form.getAll("interviewerIds").filter((v): v is string => typeof v === "string" && isUuid(v));
  if (ids.length === 0) return [];
  const rows = await db()
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...new Set(ids)]), eq(users.active, true)));
  const valid = rows.map((r) => r.id);
  if (valid.length) {
    await db()
      .insert(jobTeam)
      .values(valid.map((userId) => ({ jobId, userId })))
      .onConflictDoNothing();
  }
  return valid;
}

export async function scheduleInterviewAction(interviewId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(canManageHiring);
  const found = await loadForManager(user, interviewId);
  if (!found) return { error: "Interview not found." };
  const parsed = parseScheduledAt(String(form.get("scheduledAt") ?? ""), Number(form.get("tzOffset")));
  if (!parsed.ok) return { error: parsed.error };

  await db().transaction(async (tx) => {
    await tx.update(interviews).set({ scheduledAt: parsed.value }).where(eq(interviews.id, interviewId));
    await logActivity(tx, {
      applicationId: found.app.id,
      actorId: user.id,
      type: "interview_scheduled",
      data: { interview: found.interview.name, at: parsed.value?.toISOString() ?? null },
    });
  });
  refresh(found.app.candidateId, found.app.jobId);
  return { message: parsed.value ? "Scheduled." : "Time cleared." };
}

/** Mark held (interviewers now owe feedback), cancel, or restore a cancelled interview. */
export async function setInterviewStateAction(
  interviewId: string,
  change: "complete" | "cancel" | "restore",
): Promise<void> {
  const user = await requireUser(canManageHiring);
  const found = await loadForManager(user, interviewId);
  if (!found) return;
  const now = new Date();
  const set =
    change === "complete" ? { completedAt: now } : change === "cancel" ? { cancelledAt: now } : { cancelledAt: null };

  await db().transaction(async (tx) => {
    await tx.update(interviews).set(set).where(eq(interviews.id, interviewId));
    if (change !== "restore") {
      await logActivity(tx, {
        applicationId: found.app.id,
        actorId: user.id,
        type: change === "complete" ? "interview_completed" : "interview_cancelled",
        data: { interview: found.interview.name },
      });
    }
  });
  refresh(found.app.candidateId, found.app.jobId);
}

export async function setInterviewersAction(interviewId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(canManageHiring);
  const found = await loadForManager(user, interviewId);
  if (!found) return { error: "Interview not found." };
  const ids = await validInterviewers(found.app.jobId, form);

  await db().transaction(async (tx) => {
    await tx.delete(interviewInterviewers).where(eq(interviewInterviewers.interviewId, interviewId));
    if (ids.length) {
      await tx.insert(interviewInterviewers).values(ids.map((userId) => ({ interviewId, userId })));
    }
  });
  refresh(found.app.candidateId, found.app.jobId);
  return { message: "Interviewers saved." };
}

/** A one-off interview that isn't in the job's plan. */
export async function addInterviewAction(applicationId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(canManageHiring);
  const app = isUuid(applicationId) ? await getApplicationFor(user, applicationId) : null;
  if (!app) return { error: "Application not found." };
  const name = field(form, "name", 120);
  if (!name) return { error: "Give the interview a name." };
  const minutes = Number(form.get("durationMinutes") ?? 45);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
    return { error: "Length must be between 5 and 480 minutes." };
  }
  const scheduled = parseScheduledAt(String(form.get("scheduledAt") ?? ""), Number(form.get("tzOffset")));
  if (!scheduled.ok) return { error: scheduled.error };
  const ids = await validInterviewers(app.jobId, form);
  const stageName = await currentStageName(app.stageId);

  await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(interviews)
      .values({
        applicationId: app.id,
        stageId: app.stageId,
        name,
        stageName,
        durationMinutes: minutes,
        scheduledAt: scheduled.value,
      })
      .returning({ id: interviews.id });
    if (ids.length) {
      await tx.insert(interviewInterviewers).values(ids.map((userId) => ({ interviewId: row.id, userId })));
    }
    await logActivity(tx, {
      applicationId: app.id,
      actorId: user.id,
      type: "interview_added",
      data: { interview: name },
    });
  });
  refresh(app.candidateId, app.jobId);
  return { message: "Interview added." };
}

/** For candidates who entered their stage before it had a plan. */
export async function createPlannedInterviewsAction(applicationId: string): Promise<void> {
  const user = await requireUser(canManageHiring);
  const app = isUuid(applicationId) ? await getApplicationFor(user, applicationId) : null;
  if (!app?.stageId || app.status !== "active") return;
  await db().transaction((tx) => createStageInterviews(tx, app.id, app.stageId!));
  refresh(app.candidateId, app.jobId);
}
