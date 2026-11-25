import { NextRequest, NextResponse } from "next/server";
import { bookableSlots, loadBooking } from "@/lib/booking";

export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await loadBooking(token);
  if (!booking) return NextResponse.json({ error: "Booking link unavailable." }, { status: 404 });
  if (booking.interview.scheduledAt) return NextResponse.json({ slots: [], confirmedAt: booking.interview.googleSyncFingerprint
    ? booking.interview.scheduledAt.toISOString() : null });
  try { return NextResponse.json({ slots: await bookableSlots(booking) }); }
  catch { return NextResponse.json({ error: "Calendar availability is temporarily unavailable." }, { status: 503 }); }
}
