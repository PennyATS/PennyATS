import { and, eq } from "drizzle-orm";
import { applications, candidateAvailabilityLinks, candidateAvailabilityWindows, candidates, jobs, stages } from "@pennyats/db";
import { bookingTokenHash, loadBooking } from "./booking";
import { db } from "./db";
import { parseZonedScheduledAt } from "./interviews";

export async function loadAvailabilityLink(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [link] = await db().select().from(candidateAvailabilityLinks)
    .where(eq(candidateAvailabilityLinks.tokenHash, bookingTokenHash(token)));
  if (!link || link.revokedAt || link.expiresAt <= new Date()) return null;
  const [record] = await db().select({ application: applications, candidate: candidates, job: jobs, stage: stages })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(stages, eq(stages.id, applications.stageId))
    .where(eq(applications.id, link.applicationId));
  if (!record || record.application.status !== "active" || record.application.stageId !== link.stageId) return null;
  return { ...record, link };
}

export async function availabilityContext(token: string, source: "availability_link" | "booking_fallback") {
  if (source === "availability_link") {
    const record = await loadAvailabilityLink(token);
    return record && { application: record.application, candidate: record.candidate,
      job: record.job, stageName: record.stage.name };
  }
  const booking = await loadBooking(token);
  if (!booking || booking.interview.scheduledAt || !booking.application.stageId) return null;
  return { application: booking.application, candidate: booking.candidate,
    job: booking.job, stageName: booking.interview.stageName };
}

export type ProposedWindow = { startsAt: Date; endsAt: Date; timeZone: string };

export function parseAvailabilityWindows(raw: string, timeZone: string, now = new Date()):
  { ok: true; value: ProposedWindow[] } | { ok: false; error: string } {
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); }
  catch { return { ok: false, error: "Choose a valid time zone." }; }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return { ok: false, error: "Enter valid availability windows." }; }
  if (!Array.isArray(value) || !value.length || value.length > 12) {
    return { ok: false, error: "Add between 1 and 12 time windows." };
  }
  const windows: ProposedWindow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.start !== "string" || typeof item.end !== "string") {
      return { ok: false, error: "Enter a start and end for every window." };
    }
    const start = parseZonedScheduledAt(item.start, timeZone);
    const end = parseZonedScheduledAt(item.end, timeZone);
    if (!start.ok || !end.ok) return { ok: false, error: "One window has an invalid or ambiguous local time." };
    if (start.value <= now || start.value > new Date(now.getTime() + 60 * 86400000) ||
      end.value <= start.value || end.value.getTime() - start.value.getTime() > 12 * 3600000) {
      return { ok: false, error: "Windows must be in the next 60 days, up to 12 hours long." };
    }
    windows.push({ startsAt: start.value, endsAt: end.value, timeZone });
  }
  windows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (windows.some((window, index) => index > 0 && window.startsAt < windows[index - 1].endsAt)) {
    return { ok: false, error: "Availability windows cannot overlap." };
  }
  return { ok: true, value: windows };
}

export async function replaceAvailabilityWindows(applicationId: string, stageId: string,
  source: "availability_link" | "booking_fallback", windows: ProposedWindow[]) {
  await db().transaction(async (tx) => {
    await tx.delete(candidateAvailabilityWindows).where(and(
      eq(candidateAvailabilityWindows.applicationId, applicationId),
      eq(candidateAvailabilityWindows.stageId, stageId),
    ));
    await tx.insert(candidateAvailabilityWindows).values(windows.map((window) => ({
      applicationId, stageId, startsAt: window.startsAt, endsAt: window.endsAt,
      timeZone: window.timeZone, source,
    })));
  });
}
