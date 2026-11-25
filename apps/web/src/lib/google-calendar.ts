import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  applications, candidates, googleCalendarConnections, interviewInterviewers,
  interviews, jobs, users,
} from "@pennyats/db";
import { db } from "./db";
import { logActivity } from "./hiring";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_URL = "https://www.googleapis.com/calendar/v3";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export function googleCalendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET && process.env.APP_URL);
}

function oauthConfig() {
  if (!googleCalendarConfigured()) throw new Error("Google Calendar is not configured.");
  return {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: new URL("/api/google-calendar/callback", process.env.APP_URL).toString(),
  };
}

export function googleAuthorizationUrl(state: string): string {
  const config = oauthConfig();
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();
  return url.toString();
}

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for Google Calendar token storage.");
  return createHash("sha256").update("pennyats-google-calendar-v1\0").update(secret).digest();
}

function encrypt(token: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value: string): string {
  const [nonce, tag, body] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!nonce || !tag || !body || nonce.length !== 12 || tag.length !== 16) throw new Error("Invalid calendar credential.");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}

type TokenResponse = { access_token?: string; refresh_token?: string; error?: string };

export async function exchangeGoogleCode(code: string): Promise<string> {
  const config = oauthConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json() as TokenResponse;
  if (!response.ok || !data.refresh_token) throw new Error("Google did not provide a reusable calendar grant. Try connecting again.");
  return data.refresh_token;
}

export async function saveGoogleConnection(userId: string, refreshToken: string) {
  await db().insert(googleCalendarConnections).values({
    userId, refreshTokenEncrypted: encrypt(refreshToken), lastError: null,
  }).onConflictDoUpdate({
    target: googleCalendarConnections.userId,
    set: { refreshTokenEncrypted: encrypt(refreshToken), lastError: null, updatedAt: new Date() },
  });
}

export async function disconnectGoogleCalendar(userId: string) {
  await db().delete(googleCalendarConnections).where(eq(googleCalendarConnections.userId, userId));
}

export async function calendarConnectionState(userId: string) {
  const [row] = await db().select({ connectedAt: googleCalendarConnections.connectedAt,
    lastError: googleCalendarConnections.lastError,
    workingTimeZone: googleCalendarConnections.workingTimeZone,
    workingDays: googleCalendarConnections.workingDays,
    workStartMinute: googleCalendarConnections.workStartMinute,
    workEndMinute: googleCalendarConnections.workEndMinute })
    .from(googleCalendarConnections).where(eq(googleCalendarConnections.userId, userId));
  return row ?? null;
}

async function accessToken(userId: string): Promise<string> {
  const config = oauthConfig();
  const [connection] = await db().select().from(googleCalendarConnections)
    .where(eq(googleCalendarConnections.userId, userId));
  if (!connection) throw new Error("Google Calendar is not connected.");
  let refreshToken: string;
  try { refreshToken = decrypt(connection.refreshTokenEncrypted); }
  catch { throw new Error("Google Calendar credentials cannot be read. Reconnect the calendar."); }
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId, client_secret: config.clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json() as TokenResponse;
  if (!response.ok || !data.access_token) {
    await db().update(googleCalendarConnections).set({ lastError: "Calendar access failed. Reconnect Google Calendar." })
      .where(eq(googleCalendarConnections.userId, userId));
    throw new Error("Calendar access failed. Reconnect Google Calendar.");
  }
  return data.access_token;
}

async function calendarRequest(userId: string, path: string, init: RequestInit) {
  const token = await accessToken(userId);
  return fetch(`${CALENDAR_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(10000),
  });
}

export type CalendarBusy = { start: Date; end: Date };

export async function googleFreeBusy(userId: string, start: Date, end: Date): Promise<CalendarBusy[]> {
  const response = await calendarRequest(userId, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: "primary" }] }),
  });
  if (!response.ok) throw new Error("Google Calendar availability is unavailable.");
  const data = await response.json() as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> };
  const calendar = data.calendars?.primary;
  if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) {
    throw new Error("Google Calendar availability is unavailable.");
  }
  return calendar.busy.map((interval) => ({ start: new Date(interval.start), end: new Date(interval.end) }));
}

export function googleEventId(interviewId: string): string {
  return interviewId.replaceAll("-", "").toLowerCase();
}

const syncMessage = "Calendar invitation could not be synchronized. Check the connection and retry.";

/** Sync one saved interview. Event IDs are deterministic, so a retry cannot create a second event. */
export async function syncGoogleInterview(interviewId: string): Promise<void> {
  const [row] = await db().select({ interview: interviews, candidate: candidates, job: jobs })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(interviews.id, interviewId));
  if (!row || !row.interview.scheduledAt || row.interview.cancelledAt) return;
  const assigned = await db().select({ id: users.id, email: users.email })
    .from(interviewInterviewers).innerJoin(users, eq(users.id, interviewInterviewers.userId))
    .where(eq(interviewInterviewers.interviewId, interviewId));
  const connected = assigned.length ? await db().select({ userId: googleCalendarConnections.userId })
    .from(googleCalendarConnections)
    .where(inArray(googleCalendarConnections.userId, assigned.map((person) => person.id))) : [];
  const ownerId = row.interview.googleEventOwnerId ?? assigned.find((person) => connected.some((c) => c.userId === person.id))?.id;
  if (!ownerId) return; // The self-hosted manual path has no calendar dependency.
  const id = row.interview.googleEventId ?? googleEventId(interviewId);
  if (!row.candidate.email) {
    await db().update(interviews).set({ googleSyncError: "Add a candidate email before sending a calendar invitation." })
      .where(eq(interviews.id, interviewId));
    return;
  }
  await db().update(interviews).set({ googleEventOwnerId: ownerId, googleEventId: id })
    .where(eq(interviews.id, interviewId));
  const event = {
    id,
    summary: `${row.interview.name} — ${row.candidate.fullName}`,
    description: `Interview for ${row.job.title}, scheduled in PennyATS.`,
    start: { dateTime: row.interview.scheduledAt.toISOString(), timeZone: row.interview.scheduledTimeZone ?? "UTC" },
    end: { dateTime: new Date(row.interview.scheduledAt.getTime() + row.interview.durationMinutes * 60000).toISOString(),
      timeZone: row.interview.scheduledTimeZone ?? "UTC" },
    location: row.interview.meetingLocation ?? undefined,
    attendees: [...new Set([row.candidate.email, ...assigned.filter((person) => person.id !== ownerId).map((person) => person.email)])]
      .map((email) => ({ email })),
    extendedProperties: { private: { pennyatsInterviewId: interviewId } },
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  if (row.interview.googleSyncFingerprint === fingerprint && !row.interview.googleSyncError) return;
  const collectionPath = "/calendars/primary/events?sendUpdates=all";
  const itemPath = `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`;
  try {
    const write = (method: "POST" | "PATCH") => calendarRequest(ownerId,
      method === "POST" ? collectionPath : itemPath,
      { method, body: JSON.stringify(event) });
    let response = await write(row.interview.googleEventId ? "PATCH" : "POST");
    if (response.status === 404) response = await write("POST");
    if (response.status === 409) response = await write("PATCH");
    if (!response.ok) throw new Error(syncMessage);
    const savedEvent = await response.json() as { etag?: string };
    await db().update(interviews).set({ googleSyncError: null, googleSyncFingerprint: fingerprint,
      googleEventEtag: savedEvent.etag ?? null, googleLastSyncedAt: new Date() })
      .where(eq(interviews.id, interviewId));
  } catch {
    await db().update(interviews).set({ googleSyncError: syncMessage }).where(eq(interviews.id, interviewId));
  }
}

export async function cancelGoogleInterview(interviewId: string): Promise<void> {
  const [row] = await db().select({ id: interviews.googleEventId, ownerId: interviews.googleEventOwnerId })
    .from(interviews).where(eq(interviews.id, interviewId));
  if (!row?.id || !row.ownerId) return;
  try {
    const response = await calendarRequest(row.ownerId,
      `/calendars/primary/events/${encodeURIComponent(row.id)}?sendUpdates=all`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(syncMessage);
    await db().update(interviews).set({ googleSyncError: null, googleSyncFingerprint: null })
      .where(eq(interviews.id, interviewId));
  } catch {
    await db().update(interviews).set({ googleSyncError: syncMessage }).where(eq(interviews.id, interviewId));
  }
}

type GoogleEvent = {
  etag?: string;
  status?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string };
  location?: string;
  attendees?: { email?: string; responseStatus?: string }[];
};

/** Reconcile one linked Google event without sending an outbound update. */
export async function pullGoogleInterview(interviewId: string): Promise<"unchanged" | "updated" | "failed"> {
  const [row] = await db().select({ interview: interviews, application: applications, candidate: candidates })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(eq(interviews.id, interviewId));
  if (!row?.interview.googleEventId || !row.interview.googleEventOwnerId) return "unchanged";
  try {
    const response = await calendarRequest(row.interview.googleEventOwnerId,
      `/calendars/primary/events/${encodeURIComponent(row.interview.googleEventId)}`, { method: "GET" });
    if (response.status === 404 || response.status === 410) {
      if (row.interview.cancelledAt) return "unchanged";
      await db().transaction(async (tx) => {
        await tx.update(interviews).set({ cancelledAt: new Date(), googleSyncError: null,
          googleSyncFingerprint: null, googleLastSyncedAt: new Date() }).where(eq(interviews.id, interviewId));
        await logActivity(tx, { applicationId: row.application.id, actorId: null,
          type: "interview_cancelled", data: { interview: row.interview.name, source: "google_calendar" } });
      });
      await (await import("./scheduling-delivery")).queueInterviewReminders(interviewId);
      return "updated";
    }
    if (!response.ok) throw new Error("Google Calendar could not be read.");
    const event = await response.json() as GoogleEvent;
    if (event.status === "cancelled") {
      if (row.interview.cancelledAt) return "unchanged";
      await db().transaction(async (tx) => {
        await tx.update(interviews).set({ cancelledAt: new Date(), googleSyncError: null,
          googleSyncFingerprint: null, googleEventEtag: event.etag ?? null, googleLastSyncedAt: new Date() })
          .where(eq(interviews.id, interviewId));
        await logActivity(tx, { applicationId: row.application.id, actorId: null,
          type: "interview_cancelled", data: { interview: row.interview.name, source: "google_calendar" } });
      });
      await (await import("./scheduling-delivery")).queueInterviewReminders(interviewId);
      return "updated";
    }
    const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
    const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new Error("Google event has an invalid time.");
    }
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    if (minutes < 5 || minutes > 480) throw new Error("Google event has an unsupported duration.");
    const zone = event.start?.timeZone ?? row.interview.scheduledTimeZone ?? "UTC";
    try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(); }
    catch { throw new Error("Google event has an invalid time zone."); }
    const assigned = await db().select({ id: users.id, email: users.email })
      .from(interviewInterviewers).innerJoin(users, eq(users.id, interviewInterviewers.userId))
      .where(eq(interviewInterviewers.interviewId, interviewId));
    const attendees = event.attendees ?? [];
    const responseFor = (email: string | null) => attendees.find((person) => person.email?.toLowerCase() === email?.toLowerCase())?.responseStatus ?? null;
    const rsvps = { candidate: responseFor(row.candidate.email),
      interviewers: assigned.map((person) => ({ userId: person.id,
        status: person.id === row.interview.googleEventOwnerId ? "accepted" : responseFor(person.email) ?? "needsAction" })) };
    const location = event.location ?? null;
    const changed = row.interview.scheduledAt?.getTime() !== start.getTime() ||
      row.interview.durationMinutes !== minutes || row.interview.scheduledTimeZone !== zone ||
      row.interview.meetingLocation !== location;
    await db().transaction(async (tx) => {
      await tx.update(interviews).set({ scheduledAt: start, durationMinutes: minutes,
        scheduledTimeZone: zone, meetingLocation: location, googleRsvps: rsvps,
        googleEventEtag: event.etag ?? null, googleSyncError: null, googleLastSyncedAt: new Date() })
        .where(eq(interviews.id, interviewId));
      if (changed) await logActivity(tx, { applicationId: row.application.id, actorId: null,
        type: "interview_scheduled", data: { interview: row.interview.name, at: start.toISOString(),
          previousAt: row.interview.scheduledAt?.toISOString() ?? null, timeZone: zone,
          source: "google_calendar" } });
    });
    if (changed) await (await import("./scheduling-delivery")).queueInterviewReminders(interviewId);
    return changed ? "updated" : "unchanged";
  } catch {
    await db().update(interviews).set({ googleSyncError: "Google Calendar could not be refreshed. Check the connection and retry." })
      .where(eq(interviews.id, interviewId));
    return "failed";
  }
}

export async function pullAllGoogleInterviews() {
  const rows = await db().select({ id: interviews.id }).from(interviews)
    .where(and(isNotNull(interviews.googleEventId), isNull(interviews.cancelledAt)));
  const results = { checked: 0, updated: 0, failed: 0 };
  for (const row of rows) {
    const status = await pullGoogleInterview(row.id);
    results.checked++;
    if (status === "updated") results.updated++;
    if (status === "failed") results.failed++;
  }
  return results;
}
