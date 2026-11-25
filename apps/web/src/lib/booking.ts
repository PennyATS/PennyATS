import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  applications, candidates, googleCalendarConnections, interviewBookingLinks,
  interviewInterviewers, interviews, jobs, users,
} from "@pennyats/db";
import { db } from "./db";
import { googleFreeBusy } from "./google-calendar";
import { localInputInZone, parseZonedScheduledAt } from "./interviews";

export function bookingToken(): string {
  return randomBytes(32).toString("base64url");
}

export function bookingTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function loadBooking(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [link] = await db().select().from(interviewBookingLinks)
    .where(eq(interviewBookingLinks.tokenHash, bookingTokenHash(token)));
  if (!link || link.revokedAt || link.expiresAt <= new Date()) return null;
  const [record] = await db().select({ interview: interviews, application: applications,
    candidate: candidates, job: jobs })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(interviews.id, link.interviewId));
  if (!record || record.application.status !== "active" ||
    record.application.stageId !== record.interview.stageId || record.interview.cancelledAt ||
    record.interview.completedAt || !record.candidate.email) return null;
  const assigned = await db().select({ id: users.id, name: users.name, email: users.email })
    .from(interviewInterviewers).innerJoin(users, eq(users.id, interviewInterviewers.userId))
    .where(eq(interviewInterviewers.interviewId, link.interviewId));
  if (assigned.length !== 1) return null;
  const [connection] = await db().select().from(googleCalendarConnections)
    .where(eq(googleCalendarConnections.userId, assigned[0].id));
  if (!connection) return null;
  return { link, ...record, interviewer: assigned[0], connection };
}

function addDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export type BookableSlot = { start: string };

export function workingHourSlots(input: {
  from: Date; until: Date; timeZone: string; workingDays: number[];
  startMinute: number; endMinute: number; durationMinutes: number;
  busy: { start: Date; end: Date }[];
}): BookableSlot[] {
  const { from, until, busy } = input;
  const firstDay = localInputInZone(from, input.timeZone).slice(0, 10);
  const lastDay = localInputInZone(until, input.timeZone).slice(0, 10);
  const slots: BookableSlot[] = [];
  for (let day = firstDay; day <= lastDay; day = addDay(day, 1)) {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    if (!input.workingDays.includes(weekday)) continue;
    for (let minute = input.startMinute;
      minute + input.durationMinutes <= input.endMinute; minute += 30) {
      const local = `${day}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const parsed = parseZonedScheduledAt(local, input.timeZone);
      if (!parsed.ok) continue;
      const start = parsed.value.getTime();
      const end = start + input.durationMinutes * 60000;
      if (start < from.getTime() || end > until.getTime()) continue;
      if (busy.some((interval) => interval.start.getTime() < end && interval.end.getTime() > start)) continue;
      slots.push({ start: parsed.value.toISOString() });
    }
  }
  return slots;
}

/** Only exact, currently bookable starts leave the server. Calendar event details never do. */
export async function bookableSlots(booking: NonNullable<Awaited<ReturnType<typeof loadBooking>>>, now = new Date()): Promise<BookableSlot[]> {
  if (booking.interview.scheduledAt) return [];
  const from = new Date(now.getTime() + 30 * 60000);
  const until = new Date(now.getTime() + 14 * 86400000);
  const googleBusy = await googleFreeBusy(booking.interviewer.id, from, until);
  const recorded = await db().select({ scheduledAt: interviews.scheduledAt, durationMinutes: interviews.durationMinutes,
    interviewId: interviews.id })
    .from(interviewInterviewers).innerJoin(interviews, eq(interviews.id, interviewInterviewers.interviewId))
    .where(and(eq(interviewInterviewers.userId, booking.interviewer.id), isNotNull(interviews.scheduledAt), isNull(interviews.cancelledAt)));
  const busy = [
    ...googleBusy,
    ...recorded.filter((item) => item.scheduledAt && item.interviewId !== booking.interview.id)
      .map((item) => ({ start: item.scheduledAt!, end: new Date(item.scheduledAt!.getTime() + item.durationMinutes * 60000) })),
  ];
  return workingHourSlots({ from, until, timeZone: booking.connection.workingTimeZone,
    workingDays: booking.connection.workingDays, startMinute: booking.connection.workStartMinute,
    endMinute: booking.connection.workEndMinute, durationMinutes: booking.interview.durationMinutes, busy });
}
