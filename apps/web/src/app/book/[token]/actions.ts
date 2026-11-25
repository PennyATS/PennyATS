"use server";

import { and, eq, sql } from "drizzle-orm";
import { interviewBookingLinks, interviews } from "@pennyats/db";
import { db } from "@/lib/db";
import { bookableSlots, bookingTokenHash, loadBooking } from "@/lib/booking";
import { syncGoogleInterview } from "@/lib/google-calendar";
import { logActivity } from "@/lib/hiring";
import { queueInterviewReminders } from "@/lib/scheduling-delivery";

export type BookingState = { error?: string; confirmedAt?: string; pendingAt?: string } | undefined;

export async function confirmBookingAction(token: string, _: BookingState, form: FormData): Promise<BookingState> {
  const booking = await loadBooking(token);
  if (!booking) return { error: "This booking link is no longer available. Ask the recruiter for a new link." };
  const slot = String(form.get("slot") ?? "");
  const timeZone = String(form.get("timeZone") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(slot)) return { error: "Choose a listed time." };
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); }
  catch { return { error: "Choose a valid time zone." }; }
  if (booking.interview.scheduledAt) {
    if (booking.interview.scheduledAt.toISOString() !== slot) return { error: "This interview has already been booked." };
    if (booking.interview.googleSyncFingerprint && !booking.interview.googleSyncError) return { confirmedAt: slot };
    await syncGoogleInterview(booking.interview.id);
  } else {
    const result = await db().transaction(async (tx) => {
      // Manual scheduling uses the same lock, so one interviewer cannot take two PennyATS slots at once.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${booking.interviewer.id})::bigint)`);
      const [link] = await tx.select().from(interviewBookingLinks)
        .where(and(eq(interviewBookingLinks.interviewId, booking.interview.id),
          eq(interviewBookingLinks.tokenHash, bookingTokenHash(token))));
      const [current] = await tx.select().from(interviews).where(eq(interviews.id, booking.interview.id));
      if (!link || link.revokedAt || link.expiresAt <= new Date() || !current || current.cancelledAt || current.completedAt) {
        return { error: "This booking link is no longer available." };
      }
      if (current.scheduledAt) return { error: "This interview has already been booked." };
      let available;
      try { available = await bookableSlots(booking); }
      catch { return { error: "Calendar availability is temporarily unavailable. Try again shortly." }; }
      if (!available.some((item) => item.start === slot)) return { error: "That time is no longer available. Choose another slot." };
      await tx.update(interviews).set({ scheduledAt: new Date(slot), scheduledTimeZone: timeZone })
        .where(eq(interviews.id, booking.interview.id));
      await logActivity(tx, { applicationId: booking.application.id, actorId: null,
        type: "interview_scheduled", data: { interview: booking.interview.name, at: slot,
          timeZone, source: "candidate_booking" } });
      return { error: null };
    });
    if (result.error) return { error: result.error };
    await syncGoogleInterview(booking.interview.id);
  }
  await queueInterviewReminders(booking.interview.id);
  const [saved] = await db().select({ googleSyncError: interviews.googleSyncError,
    googleSyncFingerprint: interviews.googleSyncFingerprint })
    .from(interviews).where(eq(interviews.id, booking.interview.id));
  return saved?.googleSyncFingerprint && !saved.googleSyncError
    ? { confirmedAt: slot }
    : { pendingAt: slot, error: "The time is held, but the calendar invitation could not be sent. The recruiter has been notified in PennyATS." };
}
