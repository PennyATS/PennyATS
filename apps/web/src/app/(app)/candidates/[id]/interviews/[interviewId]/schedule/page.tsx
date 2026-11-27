import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { candidates, googleCalendarConnections, interviewInterviewers, interviews, jobs, users } from "@pennyats/db";
import { requireInterviewAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { getApplicationFor } from "@/lib/hiring";
import { googleCalendarConfigured } from "@/lib/google-calendar";
import { isUuid } from "@/lib/validation";
import { ScheduleEditor } from "./schedule-editor";

export default async function ScheduleInterviewPage({
  params,
}: {
  params: Promise<{ id: string; interviewId: string }>;
}) {
  const { id, interviewId } = await params;
  const user = await requireInterviewAccess("interviews.schedule", interviewId);
  if (!isUuid(id) || !isUuid(interviewId)) notFound();
  const [interview] = await db().select().from(interviews).where(eq(interviews.id, interviewId));
  if (!interview) notFound();
  const app = await getApplicationFor(user, interview.applicationId);
  if (!app || app.candidateId !== id) notFound();
  if (app.status !== "active" || interview.cancelledAt || interview.completedAt) redirect(`/candidates/${id}`);

  const [[candidate], [job], assigned] = await Promise.all([
    db().select({ name: candidates.fullName, email: candidates.email }).from(candidates).where(eq(candidates.id, id)),
    db().select({ title: jobs.title }).from(jobs).where(eq(jobs.id, app.jobId)),
    db().select({ id: users.id, name: users.name }).from(interviewInterviewers)
      .innerJoin(users, eq(users.id, interviewInterviewers.userId))
      .where(eq(interviewInterviewers.interviewId, interviewId)),
  ]);
  if (!candidate || !job) notFound();
  const connections = assigned.length ? await db().select({ userId: googleCalendarConnections.userId })
    .from(googleCalendarConnections)
    .where(inArray(googleCalendarConnections.userId, assigned.map((person) => person.id))) : [];
  const otherSchedules = assigned.length ? await db()
    .select({ interviewId: interviews.id, interviewerId: interviewInterviewers.userId,
      interviewerName: users.name, scheduledAt: interviews.scheduledAt,
      durationMinutes: interviews.durationMinutes })
    .from(interviewInterviewers)
    .innerJoin(interviews, eq(interviews.id, interviewInterviewers.interviewId))
    .innerJoin(users, eq(users.id, interviewInterviewers.userId))
    .where(and(inArray(interviewInterviewers.userId, assigned.map((person) => person.id)),
      isNotNull(interviews.scheduledAt), isNull(interviews.cancelledAt)))
    : [];

  return (
    <div className="mx-auto max-w-[1440px]">
      <Link href={`/candidates/${id}`} className="link text-sm">← Back to {candidate.name}</Link>
      <ScheduleEditor
        candidate={{ id, name: candidate.name, email: candidate.email }}
        jobTitle={job.title}
        interview={{ id: interview.id, name: interview.name, stageName: interview.stageName,
          durationMinutes: interview.durationMinutes, scheduledAt: interview.scheduledAt?.toISOString() ?? null,
          timeZone: interview.scheduledTimeZone, meetingLocation: interview.meetingLocation }}
        interviewers={assigned}
        willInvite={Boolean(candidate.email && googleCalendarConfigured() && connections.length)}
        otherSchedules={otherSchedules.filter((row) => row.scheduledAt !== null).map((row) => ({
          ...row, scheduledAt: row.scheduledAt!.toISOString(),
        }))}
      />
    </div>
  );
}
