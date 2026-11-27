"use server";

import { notify } from "@/lib/notifications";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { candidateAvailabilityLinks, candidates, googleCalendarConnections, interviewBookingLinks, interviewInterviewers } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { requireUser, requireApplicationAccess, requireInterviewAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookingToken, bookingTokenHash } from "@/lib/booking";
import { cancelGoogleInterview, googleCalendarConfigured, pullGoogleInterview, syncGoogleInterview } from "@/lib/google-calendar";
import { createStageInterviews, getApplicationFor } from "@/lib/hiring";
import { parseZonedScheduledAt } from "@/lib/interviews";
import { queueInterviewReminders, suppressQueuedStageLinks } from "@/lib/scheduling-delivery";
import { field, isUuid } from "@/lib/validation";
import { activeInterviewers, addInterview } from "@/lib/pipeline";
import { loadInterviewFor, scheduleInterview, setInterviewState } from "@/lib/interview-ops";

/** Load an interview the user may manage, with its application. */
const loadForManager = loadInterviewFor;

function refresh(candidateId: string, jobId: string) {
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/jobs/${jobId}`);
}

/** Only active users can be assigned; they join the job's hiring team so they can see it. */
async function validInterviewers(jobId: string, form: FormData): Promise<string[]> {
  const ids = form.getAll("interviewerIds").filter((v): v is string => typeof v === "string" && isUuid(v));
  return activeInterviewers(jobId, ids);
}

export async function saveManualScheduleAction(interviewId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireInterviewAccess("interviews.schedule", interviewId);
  const found = await loadForManager(user, interviewId);
  if (!found) return { error: "Interview not found." };
  if (found.app.status !== "active" || found.interview.cancelledAt || found.interview.completedAt) {
    return { error: "This interview can no longer be scheduled." };
  }
  const timeZone = field(form, "timeZone", 100);
  if (!timeZone) return { error: "Choose a time zone." };
  const parsed = parseZonedScheduledAt(String(form.get("scheduledLocal") ?? ""), timeZone);
  if (!parsed.ok) return { error: parsed.error };
  const result = await scheduleInterview(user, interviewId, {
    at: parsed.value,
    timeZone,
    meetingLocation: field(form, "meetingLocation", 500),
  });
  if (!result.ok) return { error: result.error };
  refresh(found.app.candidateId, found.app.jobId);
  redirect(`/candidates/${found.app.candidateId}`);
}

/** Mark held (interviewers now owe feedback), cancel, or restore a cancelled interview. */
export async function setInterviewStateAction(
  interviewId: string,
  change: "complete" | "cancel" | "restore",
): Promise<void> {
  const user = await requireInterviewAccess("interviews.schedule", interviewId);
  const found = await loadForManager(user, interviewId);
  if (!found) return;
  if (await setInterviewState(user, interviewId, change)) refresh(found.app.candidateId, found.app.jobId);
}

export async function retryCalendarSyncAction(interviewId: string): Promise<void> {
  const user = await requireInterviewAccess("interviews.schedule", interviewId);
  const found = await loadForManager(user, interviewId);
  if (!found) return;
  if (found.interview.cancelledAt) await cancelGoogleInterview(interviewId);
  else await syncGoogleInterview(interviewId);
  refresh(found.app.candidateId, found.app.jobId);
}

export async function refreshGoogleEventAction(interviewId: string): Promise<void> {
  const user = await requireInterviewAccess("interviews.schedule", interviewId);
  const found = await loadForManager(user, interviewId);
  if (!found?.interview.googleEventId) return;
  await pullGoogleInterview(interviewId);
  refresh(found.app.candidateId, found.app.jobId);
}

export type BookingLinkState = { error?: string; url?: string; message?: string } | undefined;

export async function createBookingLinkAction(interviewId: string, _: BookingLinkState): Promise<BookingLinkState> {
  const user = await requireInterviewAccess("interviews.schedule", interviewId);
  const found = await loadForManager(user, interviewId);
  if (!found || found.app.status !== "active" || found.interview.cancelledAt ||
    found.interview.completedAt || found.interview.scheduledAt) return { error: "This interview cannot be booked." };
  if (!googleCalendarConfigured()) return { error: "Configure Google Calendar before creating booking links." };
  const assigned = await db().select({ id: interviewInterviewers.userId }).from(interviewInterviewers)
    .where(eq(interviewInterviewers.interviewId, interviewId));
  if (assigned.length !== 1) return { error: "Direct booking needs exactly one interviewer." };
  const [connection] = await db().select({ userId: googleCalendarConnections.userId })
    .from(googleCalendarConnections).where(eq(googleCalendarConnections.userId, assigned[0].id));
  if (!connection) return { error: "The interviewer must connect Google Calendar first." };
  const [candidate] = await db().select({ email: candidates.email }).from(candidates)
    .where(eq(candidates.id, found.app.candidateId));
  if (!candidate?.email) return { error: "Add the candidate's email before creating a booking link." };
  const token = bookingToken();
  const now = new Date();
  await db().insert(interviewBookingLinks).values({ interviewId, tokenHash: bookingTokenHash(token),
    expiresAt: new Date(now.getTime() + 30 * 86400000) })
    .onConflictDoUpdate({ target: interviewBookingLinks.interviewId,
      set: { tokenHash: bookingTokenHash(token), expiresAt: new Date(now.getTime() + 30 * 86400000),
        revokedAt: null, createdAt: now } });
  if (found.app.stageId) await suppressQueuedStageLinks(found.app.id, found.app.stageId);
  refresh(found.app.candidateId, found.app.jobId);
  return { url: new URL(`/book/${token}`, process.env.APP_URL).toString() };
}

export async function revokeBookingLinkAction(interviewId: string, _: BookingLinkState): Promise<BookingLinkState> {
  const user = await requireInterviewAccess("interviews.schedule", interviewId);
  const found = await loadForManager(user, interviewId);
  if (!found) return { error: "Interview not found." };
  await db().update(interviewBookingLinks).set({ revokedAt: new Date() })
    .where(eq(interviewBookingLinks.interviewId, interviewId));
  if (found.app.stageId) await suppressQueuedStageLinks(found.app.id, found.app.stageId);
  refresh(found.app.candidateId, found.app.jobId);
  return { message: "Booking link revoked." };
}

export async function manageBookingLinkAction(interviewId: string, state: BookingLinkState, form: FormData): Promise<BookingLinkState> {
  return form.get("intent") === "revoke"
    ? revokeBookingLinkAction(interviewId, state)
    : createBookingLinkAction(interviewId, state);
}

export async function manageAvailabilityLinkAction(applicationId: string, _: BookingLinkState, form: FormData): Promise<BookingLinkState> {
  const user = await requireApplicationAccess("interviews.schedule", applicationId);
  const app = isUuid(applicationId) ? await getApplicationFor(user, applicationId) : null;
  if (!app || app.status !== "active" || !app.stageId) return { error: "This application cannot request availability." };
  if (form.get("intent") === "revoke") {
    await db().update(candidateAvailabilityLinks).set({ revokedAt: new Date() })
      .where(eq(candidateAvailabilityLinks.applicationId, applicationId));
    await suppressQueuedStageLinks(app.id, app.stageId);
    refresh(app.candidateId, app.jobId);
    return { message: "Availability link revoked." };
  }
  const token = bookingToken();
  const now = new Date();
  await db().insert(candidateAvailabilityLinks).values({ applicationId, stageId: app.stageId,
    tokenHash: bookingTokenHash(token), expiresAt: new Date(now.getTime() + 30 * 86400000) })
    .onConflictDoUpdate({ target: candidateAvailabilityLinks.applicationId,
      set: { stageId: app.stageId!, tokenHash: bookingTokenHash(token),
        expiresAt: new Date(now.getTime() + 30 * 86400000), revokedAt: null, createdAt: now } });
  await suppressQueuedStageLinks(app.id, app.stageId);
  refresh(app.candidateId, app.jobId);
  return { url: new URL(`/availability/${token}`, process.env.APP_URL).toString() };
}

export async function setInterviewersAction(interviewId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireInterviewAccess("interviews.schedule", interviewId);
  const found = await loadForManager(user, interviewId);
  if (!found) return { error: "Interview not found." };
  const ids = await validInterviewers(found.app.jobId, form);

  await db().transaction(async (tx) => {
    const before = await tx.select({ userId: interviewInterviewers.userId }).from(interviewInterviewers)
      .where(eq(interviewInterviewers.interviewId, interviewId));
    await tx.delete(interviewInterviewers).where(eq(interviewInterviewers.interviewId, interviewId));
    if (ids.length) {
      await tx.insert(interviewInterviewers).values(ids.map((userId) => ({ interviewId, userId })));
    }
    // Only people newly added hear about it.
    const added = ids.filter((id) => !before.some((b) => b.userId === id));
    await notify(tx, user.id, added.map((userId) => ({ userId, kind: "interview_assigned" as const, applicationId: found.app.id, interviewId })));
  });
  if (found.interview.scheduledAt) await syncGoogleInterview(interviewId);
  if (found.interview.scheduledAt) await queueInterviewReminders(interviewId);
  refresh(found.app.candidateId, found.app.jobId);
  return { message: "Interviewers saved." };
}

/** A one-off interview that isn't in the job's plan. */
export async function addInterviewAction(applicationId: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireApplicationAccess("interviews.schedule", applicationId);
  const app = isUuid(applicationId) ? await getApplicationFor(user, applicationId) : null;
  if (!app) return { error: "Application not found." };
  const name = field(form, "name", 120);
  if (!name) return { error: "Give the interview a name." };
  const minutes = Number(form.get("durationMinutes") ?? 45);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
    return { error: "Length must be between 5 and 480 minutes." };
  }
  const interviewerIds = form.getAll("interviewerIds").filter((v): v is string => typeof v === "string" && isUuid(v));
  await addInterview(user, app, { name, durationMinutes: minutes, interviewerIds });
  refresh(app.candidateId, app.jobId);
  return { message: "Interview added." };
}

/** For candidates who entered their stage before it had a plan. */
export async function createPlannedInterviewsAction(applicationId: string): Promise<void> {
  const user = await requireApplicationAccess("interviews.schedule", applicationId);
  const app = isUuid(applicationId) ? await getApplicationFor(user, applicationId) : null;
  if (!app?.stageId || app.status !== "active") return;
  await db().transaction((tx) => createStageInterviews(tx, app.id, app.stageId!));
  refresh(app.candidateId, app.jobId);
}
