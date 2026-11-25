import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  applications, candidateAvailabilityLinks, candidates, googleCalendarConnections,
  interviewBookingLinks, interviewInterviewers, interviews, jobs,
  schedulingDeliveries, stageSchedulingSettings, stages, users,
} from "@pennyats/db";
import { bookingToken, bookingTokenHash } from "./booking";
import { db } from "./db";
import { googleCalendarConfigured } from "./google-calendar";
import { openSchedulingBody, sealSchedulingBody } from "./scheduling-secrets";
import { sendSmtp, smtpConfigured } from "./smtp";

export function reminderKey(interviewId: string, at: Date, email: string): string {
  return `reminder:${interviewId}:${at.toISOString()}:${email.toLowerCase()}`;
}

export async function suppressQueuedStageLinks(applicationId: string, stageId: string) {
  const rows = await db().select({ id: schedulingDeliveries.id, key: schedulingDeliveries.dedupeKey })
    .from(schedulingDeliveries).where(and(eq(schedulingDeliveries.applicationId, applicationId),
      eq(schedulingDeliveries.status, "queued")));
  for (const row of rows) if (row.key.startsWith(`stage:${applicationId}:${stageId}:`)) {
    await db().update(schedulingDeliveries).set({ status: "suppressed", updatedAt: new Date() })
      .where(eq(schedulingDeliveries.id, row.id));
  }
}

/** Called after a real stage move; one automatic link per application and stage. */
export async function queueStageLinkOnEntry(applicationId: string, stageId: string) {
  const [setting] = await db().select().from(stageSchedulingSettings)
    .where(eq(stageSchedulingSettings.stageId, stageId));
  const mode = setting?.autoLinkMode;
  if (mode !== "booking" && mode !== "availability") return;
  const [record] = await db().select({ application: applications, candidate: candidates,
    job: jobs, stage: stages })
    .from(applications).innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(stages, eq(stages.id, applications.stageId))
    .where(eq(applications.id, applicationId));
  if (!record || record.application.status !== "active" || record.application.stageId !== stageId) return;
  const key = `stage:${applicationId}:${stageId}:${mode}`;
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${applicationId})::bigint)`);
    const [current] = await tx.select({ stageId: applications.stageId, status: applications.status })
      .from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!current || current.status !== "active" || current.stageId !== stageId) return;
    const [existing] = await tx.select({ id: schedulingDeliveries.id }).from(schedulingDeliveries)
      .where(eq(schedulingDeliveries.dedupeKey, key));
    if (existing) return;
    let url: string | null = null;
    let interviewId: string | null = null;
    let error: string | null = record.candidate.email ? null : "Candidate email is missing.";
    const token = bookingToken();
    const now = new Date();
    if (!error && mode === "availability") {
      await tx.insert(candidateAvailabilityLinks).values({ applicationId, stageId,
        tokenHash: bookingTokenHash(token), expiresAt: new Date(now.getTime() + 30 * 86400000) })
        .onConflictDoUpdate({ target: candidateAvailabilityLinks.applicationId,
          set: { stageId, tokenHash: bookingTokenHash(token),
            expiresAt: new Date(now.getTime() + 30 * 86400000), revokedAt: null, createdAt: now } });
      url = new URL(`/availability/${token}`, process.env.APP_URL).toString();
    }
    if (!error && mode === "booking") {
      if (!googleCalendarConfigured()) error = "Google Calendar is not configured.";
      const stageInterviews = await tx.select({ id: interviews.id }).from(interviews)
        .where(and(eq(interviews.applicationId, applicationId), eq(interviews.stageId, stageId),
          isNull(interviews.cancelledAt), isNull(interviews.scheduledAt)));
      for (const interview of stageInterviews) {
        const assigned = await tx.select({ id: interviewInterviewers.userId }).from(interviewInterviewers)
          .where(eq(interviewInterviewers.interviewId, interview.id));
        if (assigned.length !== 1) continue;
        const [connection] = await tx.select({ id: googleCalendarConnections.userId }).from(googleCalendarConnections)
          .where(eq(googleCalendarConnections.userId, assigned[0].id));
        if (!connection) continue;
        interviewId = interview.id;
        break;
      }
      if (!error && !interviewId) error = "No single-interviewer interview has a connected Google Calendar.";
      if (!error && interviewId) {
        await tx.insert(interviewBookingLinks).values({ interviewId, tokenHash: bookingTokenHash(token),
          expiresAt: new Date(now.getTime() + 30 * 86400000) })
          .onConflictDoUpdate({ target: interviewBookingLinks.interviewId,
            set: { tokenHash: bookingTokenHash(token), expiresAt: new Date(now.getTime() + 30 * 86400000),
              revokedAt: null, createdAt: now } });
        url = new URL(`/book/${token}`, process.env.APP_URL).toString();
      }
    }
    const subject = mode === "booking" ? `Book your ${record.stage.name} interview` : `Share your ${record.stage.name} availability`;
    const body = url ? `Hi ${record.candidate.fullName.split(" ")[0]},\n\nPlease use this link for the ${record.job.title} interview stage:\n${url}\n\nThe link expires in 30 days.` : "Scheduling link unavailable.";
    await tx.insert(schedulingDeliveries).values({ dedupeKey: key, applicationId,
      candidateId: record.candidate.id, interviewId, kind: `stage_${mode}`,
      recipientEmail: record.candidate.email ?? "", subject, bodyEncrypted: sealSchedulingBody(body),
      scheduledFor: now, status: error ? "failed" : "queued", lastError: error });
  });
}

function whenLabel(date: Date, zone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}

export async function queueInterviewReminders(interviewId: string) {
  const [row] = await db().select({ interview: interviews, application: applications,
    candidate: candidates, job: jobs })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(interviews.id, interviewId));
  if (!row) return;
  const [setting] = row.interview.stageId ? await db().select().from(stageSchedulingSettings)
    .where(eq(stageSchedulingSettings.stageId, row.interview.stageId)) : [];
  const active = row.interview.scheduledAt && !row.interview.cancelledAt &&
    row.application.status === "active" && setting?.reminderMinutes;
  const assigned = active ? await db().select({ email: users.email }).from(interviewInterviewers)
    .innerJoin(users, eq(users.id, interviewInterviewers.userId))
    .where(eq(interviewInterviewers.interviewId, interviewId)) : [];
  const recipients = active ? [...new Set([row.candidate.email, ...assigned.map((person) => person.email)].filter((email): email is string => Boolean(email)))] : [];
  const keys = new Set(active ? recipients.map((email) => reminderKey(interviewId, row.interview.scheduledAt!, email)) : []);
  await db().transaction(async (tx) => {
    const old = await tx.select({ id: schedulingDeliveries.id, key: schedulingDeliveries.dedupeKey })
      .from(schedulingDeliveries).where(and(eq(schedulingDeliveries.interviewId, interviewId),
        inArray(schedulingDeliveries.status, ["queued", "failed"])));
    for (const delivery of old) if (!keys.has(delivery.key)) {
      await tx.update(schedulingDeliveries).set({ status: "suppressed", updatedAt: new Date() })
        .where(eq(schedulingDeliveries.id, delivery.id));
    }
    if (!active) return;
    const at = row.interview.scheduledAt!;
    const zone = row.interview.scheduledTimeZone ?? "UTC";
    const planned = new Date(Math.max(Date.now(), at.getTime() - setting.reminderMinutes! * 60000));
    for (const email of recipients) {
      const candidate = email === row.candidate.email;
      const body = candidate
        ? `Reminder: your ${row.interview.name} interview for ${row.job.title} is ${whenLabel(at, zone)}.${row.interview.meetingLocation ? `\nMeeting: ${row.interview.meetingLocation}` : ""}`
        : `Reminder: ${row.interview.name} with ${row.candidate.fullName} for ${row.job.title} is ${whenLabel(at, zone)}.${row.interview.meetingLocation ? `\nMeeting: ${row.interview.meetingLocation}` : ""}`;
      await tx.insert(schedulingDeliveries).values({ dedupeKey: reminderKey(interviewId, at, email),
        applicationId: row.application.id, candidateId: row.candidate.id, interviewId,
        kind: "reminder", recipientEmail: email, subject: `Interview reminder: ${row.interview.name}`,
        bodyEncrypted: sealSchedulingBody(body), scheduledFor: planned })
        .onConflictDoNothing({ target: schedulingDeliveries.dedupeKey });
    }
  });
}

function deterministicMessageId(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  const domain = process.env.SMTP_FROM?.split("@")[1] ?? "pennyats.local";
  return `<${hash}@${domain}>`;
}

export async function processDueSchedulingMail(limit = 20, send: typeof sendSmtp = sendSmtp) {
  if (!smtpConfigured()) return { processed: 0, sent: 0, failed: 0, unconfigured: true };
  const result = { processed: 0, sent: 0, failed: 0, unconfigured: false };
  for (let i = 0; i < limit; i++) {
    const delivery = await db().transaction(async (tx) => {
      const [row] = await tx.select().from(schedulingDeliveries)
        .where(and(eq(schedulingDeliveries.status, "queued"), lte(schedulingDeliveries.scheduledFor, new Date())))
        .orderBy(asc(schedulingDeliveries.scheduledFor)).limit(1).for("update", { skipLocked: true });
      if (!row) return null;
      await tx.update(schedulingDeliveries).set({ status: "sending", attempts: row.attempts + 1,
        messageId: deterministicMessageId(row.dedupeKey), updatedAt: new Date() })
        .where(eq(schedulingDeliveries.id, row.id));
      return row;
    });
    if (!delivery) break;
    result.processed++;
    if (delivery.kind === "reminder" && delivery.interviewId) {
      const [current] = await db().select({ at: interviews.scheduledAt, cancelledAt: interviews.cancelledAt })
        .from(interviews).where(eq(interviews.id, delivery.interviewId));
      if (!current || current.cancelledAt || !current.at || !delivery.dedupeKey.includes(current.at.toISOString())) {
        await db().update(schedulingDeliveries).set({ status: "suppressed", updatedAt: new Date() })
          .where(eq(schedulingDeliveries.id, delivery.id));
        continue;
      }
    }
    if (delivery.kind.startsWith("stage_")) {
      const [current] = await db().select({ stageId: applications.stageId, status: applications.status })
        .from(applications).where(eq(applications.id, delivery.applicationId));
      const stageId = delivery.dedupeKey.split(":")[2];
      if (!current || current.status !== "active" || current.stageId !== stageId) {
        await db().update(schedulingDeliveries).set({ status: "suppressed", updatedAt: new Date() })
          .where(eq(schedulingDeliveries.id, delivery.id));
        continue;
      }
    }
    try {
      await send({ to: delivery.recipientEmail, subject: delivery.subject,
        text: openSchedulingBody(delivery.bodyEncrypted), messageId: deterministicMessageId(delivery.dedupeKey) });
      await db().update(schedulingDeliveries).set({ status: "sent", sentAt: new Date(), lastError: null,
        updatedAt: new Date() }).where(eq(schedulingDeliveries.id, delivery.id));
      result.sent++;
    } catch {
      await db().update(schedulingDeliveries).set({ status: "failed",
        lastError: "SMTP did not confirm delivery. Check the mail server before retrying.", updatedAt: new Date() })
        .where(eq(schedulingDeliveries.id, delivery.id));
      result.failed++;
    }
  }
  return result;
}
