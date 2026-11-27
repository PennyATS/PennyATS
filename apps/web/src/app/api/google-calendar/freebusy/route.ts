import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { googleCalendarConnections, interviewInterviewers, interviews, users } from "@pennyats/db";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { googleFreeBusy } from "@/lib/google-calendar";
import { getApplicationFor } from "@/lib/hiring";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user, "interviews.schedule")) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const interviewId = request.nextUrl.searchParams.get("interviewId") ?? "";
  const start = new Date(request.nextUrl.searchParams.get("start") ?? "");
  const end = new Date(request.nextUrl.searchParams.get("end") ?? "");
  if (!isUuid(interviewId) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ||
    end <= start || end.getTime() - start.getTime() > 7 * 86400000) {
    return NextResponse.json({ error: "Invalid availability range." }, { status: 400 });
  }
  const [interview] = await db().select({ applicationId: interviews.applicationId })
    .from(interviews).where(eq(interviews.id, interviewId));
  if (!interview || !await getApplicationFor(user, interview.applicationId)) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }
  const assigned = await db().select({ id: users.id, name: users.name })
    .from(interviewInterviewers).innerJoin(users, eq(users.id, interviewInterviewers.userId))
    .where(eq(interviewInterviewers.interviewId, interviewId));
  const connections = assigned.length ? await db().select({ userId: googleCalendarConnections.userId })
    .from(googleCalendarConnections)
    .where(inArray(googleCalendarConnections.userId, assigned.map((person) => person.id))) : [];
  const connectedIds = new Set(connections.map((connection) => connection.userId));
  const results = await Promise.all(assigned.filter((person) => connectedIds.has(person.id)).map(async (person) => {
    try {
      const busy = await googleFreeBusy(person.id, start, end);
      return { name: person.name, busy: busy.map((interval) => ({ start: interval.start.toISOString(), end: interval.end.toISOString() })), unavailable: false };
    } catch {
      return { name: person.name, busy: [], unavailable: true };
    }
  }));
  return NextResponse.json({ calendars: results, disconnected: assigned.filter((person) => !connectedIds.has(person.id)).map((person) => person.name) });
}
