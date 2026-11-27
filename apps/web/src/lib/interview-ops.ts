/**
 * Scheduling and state changes for one interview, shared by the candidate profile's server
 * actions and the public API (and so by scheduling integrations). Callers check the role;
 * these check job access, the interview's state, and conflicts with interviewers' other interviews.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { interviewInterviewers, interviews, users } from "@pennyats/db";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { cancelGoogleInterview, syncGoogleInterview } from "./google-calendar";
import { getApplicationFor, logActivity } from "./hiring";
import { overlappingInterviews } from "./interviews";
import { queueInterviewReminders } from "./scheduling-delivery";
import { isHttpUrl, isUuid } from "./validation";

/** An interview the user may manage, with its application. Null when missing or not visible. */
export async function loadInterviewFor(user: SessionUser, interviewId: string) {
  if (!isUuid(interviewId)) return null;
  const [row] = await db().select().from(interviews).where(eq(interviews.id, interviewId));
  if (!row) return null;
  const app = await getApplicationFor(user, row.applicationId);
  return app ? { interview: row, app } : null;
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export type ScheduleResult = { ok: true } | { ok: false; code: "not_found" | "closed" | "invalid" | "conflict"; error: string };

/**
 * Set or change an interview's time and meeting location. Refuses past times, closed
 * applications and interviews, and times that overlap another interview of the same interviewer.
 */
export async function scheduleInterview(
  user: SessionUser,
  interviewId: string,
  input: { at: Date; timeZone: string; meetingLocation: string | null },
): Promise<ScheduleResult> {
  const found = await loadInterviewFor(user, interviewId);
  if (!found) return { ok: false, code: "not_found", error: "Interview not found." };
  if (found.app.status !== "active" || found.interview.cancelledAt || found.interview.completedAt) {
    return { ok: false, code: "closed", error: "This interview can no longer be scheduled." };
  }
  if (!isTimeZone(input.timeZone)) return { ok: false, code: "invalid", error: "Choose a valid time zone." };
  if (input.at <= new Date()) return { ok: false, code: "invalid", error: "Choose a future time." };
  const { meetingLocation } = input;
  if (meetingLocation && /^(https?:|[a-z]+:)/i.test(meetingLocation) && !isHttpUrl(meetingLocation)) {
    return { ok: false, code: "invalid", error: "Meeting links must start with http:// or https://." };
  }
  const assigned = await db()
    .select({ userId: interviewInterviewers.userId })
    .from(interviewInterviewers)
    .where(eq(interviewInterviewers.interviewId, interviewId));
  const ids = assigned.map((row) => row.userId).sort();

  const result = await db().transaction(async (tx) => {
    // Serialize saves for shared interviewers so two schedules cannot take the same slot.
    for (const id of ids) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id})::bigint)`);
    const others = ids.length
      ? await tx
          .select({
            interviewId: interviews.id,
            interviewerId: interviewInterviewers.userId,
            interviewerName: users.name,
            scheduledAt: interviews.scheduledAt,
            durationMinutes: interviews.durationMinutes,
          })
          .from(interviewInterviewers)
          .innerJoin(interviews, eq(interviews.id, interviewInterviewers.interviewId))
          .innerJoin(users, eq(users.id, interviewInterviewers.userId))
          .where(and(inArray(interviewInterviewers.userId, ids), isNotNull(interviews.scheduledAt), isNull(interviews.cancelledAt)))
      : [];
    const conflicts = overlappingInterviews(
      input.at,
      found.interview.durationMinutes,
      interviewId,
      others.filter((row): row is typeof row & { scheduledAt: Date } => row.scheduledAt !== null),
    );
    if (conflicts.length) {
      return { ok: false as const, code: "conflict" as const, error: `${conflicts[0].interviewerName} has another PennyATS interview at that time. Choose an open slot.` };
    }
    await tx
      .update(interviews)
      .set({ scheduledAt: input.at, scheduledTimeZone: input.timeZone, meetingLocation })
      .where(eq(interviews.id, interviewId));
    await logActivity(tx, {
      applicationId: found.app.id,
      actorId: user.id,
      type: "interview_scheduled",
      data: {
        interview: found.interview.name,
        at: input.at.toISOString(),
        previousAt: found.interview.scheduledAt?.toISOString() ?? null,
        timeZone: input.timeZone,
        meetingLocation,
      },
    });
    return { ok: true as const };
  });
  if (!result.ok) return result;
  await syncGoogleInterview(interviewId);
  await queueInterviewReminders(interviewId);
  return { ok: true };
}

export type InterviewChange = "complete" | "cancel" | "restore";

/** Mark held (interviewers now owe feedback), cancel, or restore a cancelled interview. */
export async function setInterviewState(user: SessionUser, interviewId: string, change: InterviewChange): Promise<boolean> {
  const found = await loadInterviewFor(user, interviewId);
  if (!found) return false;
  const now = new Date();
  const set = change === "complete" ? { completedAt: now } : change === "cancel" ? { cancelledAt: now } : { cancelledAt: null };
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
  if (change === "cancel") await cancelGoogleInterview(interviewId);
  if (change === "restore") await syncGoogleInterview(interviewId);
  if (change !== "complete") await queueInterviewReminders(interviewId);
  return true;
}
