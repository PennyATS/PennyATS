import { notFound } from "next/navigation";
import { loadBooking } from "@/lib/booking";
import { DirectBooking } from "./direct-booking";

export default async function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await loadBooking(token);
  if (!booking) notFound();
  return <DirectBooking token={token} candidateName={booking.candidate.fullName}
    interviewerName={booking.interviewer.name} interviewName={booking.interview.name}
    jobTitle={booking.job.title} durationMinutes={booking.interview.durationMinutes}
    confirmedAt={booking.interview.googleSyncFingerprint && !booking.interview.googleSyncError
      ? booking.interview.scheduledAt?.toISOString() ?? null : null}
    pendingAt={booking.interview.scheduledAt && (!booking.interview.googleSyncFingerprint || booking.interview.googleSyncError)
      ? booking.interview.scheduledAt.toISOString() : null} />;
}
