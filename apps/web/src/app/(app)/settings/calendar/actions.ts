"use server";

import type { FormState } from "@/components/form";
import { eq } from "drizzle-orm";
import { googleCalendarConnections } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { calendarConnectionState, disconnectGoogleCalendar, googleFreeBusy } from "@/lib/google-calendar";

export async function disconnectCalendarAction(_: FormState): Promise<FormState> {
  const user = await requireUser();
  await disconnectGoogleCalendar(user.id);
  return { message: "Google Calendar disconnected. Existing invitations remain on Google Calendar." };
}

export async function testCalendarAction(_: FormState): Promise<FormState> {
  const user = await requireUser();
  if (!await calendarConnectionState(user.id)) return { error: "Connect Google Calendar first." };
  try {
    await googleFreeBusy(user.id, new Date(), new Date(Date.now() + 7 * 86400000));
    return { message: "Google Calendar availability is working." };
  } catch {
    return { error: "Calendar availability is unavailable. Reconnect Google Calendar or check its permissions." };
  }
}

export async function saveWorkingHoursAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!await calendarConnectionState(user.id)) return { error: "Connect Google Calendar first." };
  const timeZone = String(form.get("timeZone") ?? "").trim();
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); }
  catch { return { error: "Choose a valid time zone." }; }
  const parseTime = (value: unknown) => {
    const match = typeof value === "string" ? /^(\d{2}):(\d{2})$/.exec(value) : null;
    if (!match) return null;
    const minute = Number(match[1]) * 60 + Number(match[2]);
    return Number(match[1]) < 24 && Number(match[2]) < 60 ? minute : null;
  };
  const start = parseTime(form.get("start"));
  const end = parseTime(form.get("end"));
  if (start === null || end === null || end <= start) return { error: "Choose valid working hours." };
  const days = [...new Set(form.getAll("day").map(Number))].sort();
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return { error: "Choose at least one working day." };
  }
  await db().update(googleCalendarConnections).set({
    workingTimeZone: timeZone, workingDays: days, workStartMinute: start, workEndMinute: end,
    updatedAt: new Date(),
  }).where(eq(googleCalendarConnections.userId, user.id));
  return { message: "Working hours saved." };
}
