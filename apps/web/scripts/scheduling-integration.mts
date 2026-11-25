/** Controlled integration fixture: temporary Postgres rows, fake Google API and SMTP transport. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import {
  activity, applications, candidates, googleCalendarConnections, interviewBookingLinks,
  interviewInterviewers, interviews, jobs, schedulingDeliveries, stageSchedulingSettings,
  stages, users,
} from "@pennyats/db";
import { db } from "../src/lib/db";
import { bookingToken, bookingTokenHash, bookableSlots, loadBooking } from "../src/lib/booking";
import { googleEventId, pullGoogleInterview, saveGoogleConnection, syncGoogleInterview } from "../src/lib/google-calendar";
import { processDueSchedulingMail, queueInterviewReminders, queueStageLinkOnEntry } from "../src/lib/scheduling-delivery";
import { sealSchedulingBody } from "../src/lib/scheduling-secrets";
import { confirmBookingAction } from "../src/app/book/[token]/actions";

const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET || !process.env.APP_URL) {
  throw new Error("The integration fixture needs DATABASE_URL, AUTH_SECRET and APP_URL.");
}
const priorEnv = Object.fromEntries(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM"]
  .map((key) => [key, process.env[key]]));
Object.assign(process.env, { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret",
  SMTP_HOST: "fixture.local", SMTP_PORT: "587", SMTP_FROM: "fixture@example.test" });

type Event = { id: string; start: { dateTime: string; timeZone?: string };
  end: { dateTime: string }; attendees?: { email: string; responseStatus?: string }[];
  location?: string; status?: string; etag?: string };
const events = new Map<string, Event>();
const requests: { method: string; path: string }[] = [];
let busy: { start: string; end: string }[] = [];
const sent: { to: string; messageId?: string }[] = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  requests.push({ method, path: `${url.pathname}${url.search}` });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data),
    { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "fixture-access" });
  if (url.pathname.endsWith("/freeBusy")) return json({ calendars: { primary: { busy } } });
  const match = url.pathname.match(/\/calendars\/primary\/events(?:\/([^/]+))?$/);
  if (!match) throw new Error(`Unexpected fixture request: ${url}`);
  const id = match[1];
  if (method === "POST") {
    const event = JSON.parse(String(init?.body)) as Event;
    if (events.has(event.id)) return json({}, 409);
    events.set(event.id, { ...event, etag: '"fixture-1"' });
    return json(events.get(event.id));
  }
  if (!id) return json({}, 404);
  if (method === "PATCH") {
    if (!events.has(id)) return json({}, 404);
    const event = JSON.parse(String(init?.body)) as Event;
    events.set(id, { ...event, etag: '"fixture-2"' });
    return json(events.get(id));
  }
  if (method === "DELETE") {
    if (!events.has(id)) return json({}, 404);
    events.delete(id);
    return new Response(null, { status: 204 });
  }
  return events.has(id) ? json(events.get(id)) : json({}, 404);
};
const fakeSend = async (message: { to: string; messageId?: string }) => {
  sent.push({ to: message.to, messageId: message.messageId });
  return message.messageId ?? "fixture";
};

const fixture = randomUUID().replaceAll("-", "");
let userId: string | null = null;
let jobId: string | null = null;
let candidateId: string | null = null;
try {
  const [user] = await db().insert(users).values({ email: `fixture-${fixture}@example.test`,
    name: "Fixture Interviewer", role: "interviewer" }).returning({ id: users.id });
  userId = user.id;
  const [job] = await db().insert(jobs).values({ slug: `fixture-${fixture}`, title: "Fixture Role" })
    .returning({ id: jobs.id });
  jobId = job.id;
  const [stage] = await db().insert(stages).values({ jobId, name: "Fixture interview", position: 0 })
    .returning({ id: stages.id });
  const candidateEmail = `fixture-candidate-${fixture}@example.test`;
  const [candidate] = await db().insert(candidates).values({ fullName: "Fixture Candidate",
    email: candidateEmail }).returning({ id: candidates.id });
  candidateId = candidate.id;
  const [application] = await db().insert(applications).values({ candidateId, jobId, stageId: stage.id })
    .returning({ id: applications.id });
  const [interview] = await db().insert(interviews).values({ applicationId: application.id,
    stageId: stage.id, stageName: "Fixture interview", name: "Recruiter screen", durationMinutes: 30 })
    .returning({ id: interviews.id });
  await db().insert(interviewInterviewers).values({ interviewId: interview.id, userId });
  await saveGoogleConnection(userId, "fixture-refresh");
  await db().update(googleCalendarConnections).set({ workingTimeZone: "UTC",
    workingDays: [0, 1, 2, 3, 4, 5, 6], workStartMinute: 0, workEndMinute: 1440 })
    .where(eq(googleCalendarConnections.userId, userId));
  await db().insert(stageSchedulingSettings).values({ stageId: stage.id, reminderMinutes: 60,
    autoLinkMode: "availability" });
  const token = bookingToken();
  await db().insert(interviewBookingLinks).values({ interviewId: interview.id,
    tokenHash: bookingTokenHash(token), expiresAt: new Date(Date.now() + 86400000) });
  const booking = await loadBooking(token);
  assert.ok(booking);
  const slots = await bookableSlots(booking);
  assert.ok(slots.length > 0);
  const slot = slots[0].start;
  const form = () => { const data = new FormData(); data.set("slot", slot); data.set("timeZone", "UTC"); return data; };
  const results = await Promise.all([
    confirmBookingAction(token, undefined, form()), confirmBookingAction(token, undefined, form()),
  ]);
  assert.ok(results.some((result) => result?.confirmedAt === slot), JSON.stringify(results));
  assert.equal(events.size, 1);
  assert.equal([...events.keys()][0], googleEventId(interview.id));
  const [booked] = await db().select().from(interviews).where(eq(interviews.id, interview.id));
  assert.equal(booked.scheduledAt?.toISOString(), slot);
  const scheduleEvents = await db().select().from(activity).where(eq(activity.applicationId, application.id));
  assert.equal(scheduleEvents.filter((event) => event.type === "interview_scheduled").length, 1);
  assert.equal((await confirmBookingAction(token, undefined, form()))?.confirmedAt, slot);
  assert.equal(events.size, 1);

  const [second] = await db().insert(interviews).values({ applicationId: application.id,
    stageId: stage.id, stageName: "Fixture interview", name: "Second screen", durationMinutes: 30 })
    .returning({ id: interviews.id });
  await db().insert(interviewInterviewers).values({ interviewId: second.id, userId });
  const secondToken = bookingToken();
  await db().insert(interviewBookingLinks).values({ interviewId: second.id,
    tokenHash: bookingTokenHash(secondToken), expiresAt: new Date(Date.now() + 86400000) });
  const secondBooking = await loadBooking(secondToken);
  assert.ok(secondBooking);
  const secondSlot = (await bookableSlots(secondBooking))[0].start;
  const secondForm = new FormData();
  secondForm.set("slot", secondSlot);
  secondForm.set("timeZone", "UTC");
  busy = [{ start: secondSlot, end: new Date(new Date(secondSlot).getTime() + 30 * 60000).toISOString() }];
  assert.match((await confirmBookingAction(secondToken, undefined, secondForm))?.error ?? "", /no longer available/);
  assert.equal((await db().select().from(interviews).where(eq(interviews.id, second.id)))[0].scheduledAt, null);
  busy = [];
  await db().update(interviewBookingLinks).set({ revokedAt: new Date() })
    .where(eq(interviewBookingLinks.interviewId, second.id));
  assert.equal(await loadBooking(secondToken), null);

  const outboundAt = new Date(new Date(slot).getTime() + 60 * 60000);
  await db().update(interviews).set({ scheduledAt: outboundAt }).where(eq(interviews.id, interview.id));
  await syncGoogleInterview(interview.id);
  assert.equal(events.get(googleEventId(interview.id))?.start.dateTime, outboundAt.toISOString());
  assert.equal(events.size, 1);
  await queueInterviewReminders(interview.id);
  const inboundAt = new Date(outboundAt.getTime() + 60 * 60000);
  const event = events.get(googleEventId(interview.id))!;
  events.set(event.id, { ...event, start: { dateTime: inboundAt.toISOString(), timeZone: "UTC" },
    end: { dateTime: new Date(inboundAt.getTime() + 30 * 60000).toISOString() },
    attendees: [{ email: candidateEmail, responseStatus: "accepted" }], etag: '"fixture-3"' });
  assert.equal(await pullGoogleInterview(interview.id), "updated");
  const [updated] = await db().select().from(interviews).where(eq(interviews.id, interview.id));
  assert.equal(updated.scheduledAt?.toISOString(), inboundAt.toISOString());
  assert.equal(updated.googleRsvps?.candidate, "accepted");
  const reminders = await db().select().from(schedulingDeliveries)
    .where(eq(schedulingDeliveries.interviewId, interview.id));
  assert.ok(reminders.some((row) => row.kind === "reminder" && row.status === "suppressed"));
  assert.ok(reminders.some((row) => row.kind === "reminder" && row.status === "queued"));

  await queueStageLinkOnEntry(application.id, stage.id);
  await queueStageLinkOnEntry(application.id, stage.id);
  const stageMail = await db().select().from(schedulingDeliveries)
    .where(eq(schedulingDeliveries.applicationId, application.id));
  assert.equal(stageMail.filter((row) => row.kind === "stage_availability").length, 1);
  const mailResult = await processDueSchedulingMail(20, fakeSend);
  assert.equal(mailResult.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal((await processDueSchedulingMail(20, fakeSend)).sent, 0);

  events.delete(event.id);
  assert.equal(await pullGoogleInterview(interview.id), "updated");
  const [cancelled] = await db().select().from(interviews).where(eq(interviews.id, interview.id));
  assert.ok(cancelled.cancelledAt);
  const finalMail = await db().select().from(schedulingDeliveries)
    .where(eq(schedulingDeliveries.interviewId, interview.id));
  assert.ok(finalMail.filter((row) => row.kind === "reminder").every((row) => row.status === "suppressed"));
  const [failure] = await db().insert(schedulingDeliveries).values({
    dedupeKey: `stage:${application.id}:${stage.id}:fixture-failure`, applicationId: application.id,
    candidateId, kind: "stage_availability", recipientEmail: candidateEmail,
    subject: "Fixture failure", bodyEncrypted: sealSchedulingBody("Fixture link"), scheduledFor: new Date(),
  }).returning({ id: schedulingDeliveries.id });
  assert.equal((await processDueSchedulingMail(20, async () => { throw new Error("Fixture SMTP failure"); })).failed, 1);
  assert.equal((await processDueSchedulingMail(20, fakeSend)).processed, 0);
  await db().update(schedulingDeliveries).set({ status: "queued" }).where(eq(schedulingDeliveries.id, failure.id));
  assert.equal((await processDueSchedulingMail(20, fakeSend)).sent, 1);
  const [laterStage] = await db().insert(stages).values({ jobId, name: "Next stage", position: 1 })
    .returning({ id: stages.id });
  await db().update(applications).set({ stageId: laterStage.id }).where(eq(applications.id, application.id));
  assert.equal(await loadBooking(token), null);
  assert.ok(requests.some((request) => request.method === "POST" && request.path.includes("sendUpdates=all")));
  assert.ok(requests.some((request) => request.method === "PATCH" && request.path.includes("sendUpdates=all")));

  console.log("Scheduling integration passed: concurrent/retry booking, one event, outbound/inbound sync, RSVP, reminder suppression, and deduplicated stage mail.");
} finally {
  globalThis.fetch = nativeFetch;
  if (candidateId) await db().delete(candidates).where(eq(candidates.id, candidateId));
  if (jobId) await db().delete(jobs).where(eq(jobs.id, jobId));
  if (userId) await db().delete(users).where(eq(users.id, userId));
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
process.exit(0);
