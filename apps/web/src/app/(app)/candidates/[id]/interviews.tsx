import Link from "next/link";
import { BookingLinkControl } from "./booking-link-control";
import { AvailabilityLinkControl } from "./availability-link-control";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { LocalTime } from "@/components/local-time";
import { STATUS_LABELS, type InterviewStatus } from "@/lib/interviews";
import {
  addInterviewAction,
  createPlannedInterviewsAction,
  setInterviewStateAction,
  setInterviewersAction,
  retryCalendarSyncAction,
  refreshGoogleEventAction,
} from "../interview-actions";

export type InterviewRow = {
  id: string;
  name: string;
  stageName: string;
  durationMinutes: number;
  scheduledAt: Date | null;
  scheduledTimeZone: string | null;
  meetingLocation: string | null;
  googleEventId: string | null;
  googleSyncError: string | null;
  googleRsvps: { candidate: string | null; interviewers: { userId: string; status: string }[] } | null;
  googleLastSyncedAt: Date | null;
  bookingLinkActive: boolean;
  cancelledAt: Date | null;
  status: InterviewStatus;
  overdue: boolean;
  interviewers: { id: string; name: string; submitted: boolean }[];
};

const STATUS_COLORS: Record<InterviewStatus, string> = {
  to_schedule: "var(--muted)",
  scheduled: "var(--accent)",
  feedback_due: "#d97706",
  complete: "#16a34a",
  cancelled: "var(--muted)",
};

/** The interview loop for one application, shown on the candidate profile. */
export function Interviews({
  candidateId,
  applicationId,
  rows,
  userId,
  manage,
  people,
  planAvailable,
  active,
  availabilityLinkActive,
  availability,
}: {
  candidateId: string;
  applicationId: string;
  rows: InterviewRow[];
  userId: string;
  manage: boolean;
  /** Active users who can be assigned. */
  people: { id: string; name: string }[];
  /** The job's plan has interviews for this application's stage that it doesn't have yet. */
  planAvailable: boolean;
  active: boolean;
  availabilityLinkActive: boolean;
  availability: { id: string; startsAt: Date; endsAt: Date; timeZone: string }[];
}) {
  if (rows.length === 0 && !manage) return null;

  return (
    <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <h3 className="font-medium">Interviews ({rows.filter((r) => r.status !== "cancelled").length})</h3>
      {rows.length === 0 && <p className="muted mt-1">No interviews yet.</p>}
      {manage && active && <AvailabilityLinkControl applicationId={applicationId} activeLink={availabilityLinkActive} />}
      {availability.length > 0 && <div className="inset mt-3 text-sm">
        <h4 className="font-semibold">Candidate availability</h4>
        <p className="muted mt-1 text-xs">Suggested windows, not reserved times. Schedule each interview separately.</p>
        <ul className="mt-2 space-y-1">
          {availability.map((window) => <li key={window.id}>
            {window.startsAt.toLocaleString("en-US", { timeZone: window.timeZone,
              weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {" – "}{window.endsAt.toLocaleTimeString("en-US", { timeZone: window.timeZone,
              hour: "numeric", minute: "2-digit" })} ({window.timeZone})
          </li>)}
        </ul>
      </div>}

      {manage && active && planAvailable && (
        <form action={createPlannedInterviewsAction.bind(null, applicationId)} className="mt-2">
          <button type="submit" className="btn btn-secondary">
            Set up interviews from the plan
          </button>
        </form>
      )}

      <ul className="card-rows mt-2">
        {rows.map((r) => {
          const mine = r.interviewers.find((i) => i.id === userId);
          return (
            <li key={r.id} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className={r.status === "cancelled" ? "muted line-through" : "font-medium"}>
                  {r.name} <span className="muted font-normal">· {r.stageName} · {r.durationMinutes} min</span>
                </p>
                <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: STATUS_COLORS[r.status] }}>
                  <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: STATUS_COLORS[r.status] }} />
                  {r.overdue ? "Feedback overdue" : STATUS_LABELS[r.status]}
                </span>
              </div>
              <p className="muted text-xs">
                {r.scheduledAt ? (
                  r.scheduledTimeZone ? r.scheduledAt.toLocaleString("en-US", {
                    timeZone: r.scheduledTimeZone, weekday: "short", month: "short", day: "numeric", year: "numeric",
                    hour: "numeric", minute: "2-digit", timeZoneName: "short",
                  }) : <LocalTime iso={r.scheduledAt.toISOString()} />
                ) : "Not scheduled"}
                {" · "}
                {r.interviewers.length
                  ? r.interviewers.map((i, n) => (
                      <span key={i.id}>
                        {n > 0 && ", "}
                        {i.name}
                        {i.submitted ? " (submitted)" : ""}
                      </span>
                    ))
                  : "No interviewers assigned"}
              </p>
              {r.scheduledAt && r.meetingLocation && <p className="text-xs">
                {/^https?:\/\//i.test(r.meetingLocation)
                  ? <a href={r.meetingLocation} className="link" target="_blank" rel="noopener noreferrer">Meeting link</a>
                  : <span className="muted">Location: {r.meetingLocation}</span>}
              </p>}
              {r.googleSyncError && <p role="alert" className="error text-xs">{r.googleSyncError}</p>}
              {r.scheduledAt && r.status !== "cancelled" && !r.googleSyncError && <p className="muted text-xs">
                {r.googleEventId ? "Google Calendar invitations sent." : "Saved in PennyATS. Share details with the candidate manually; no invite was sent."}
              </p>}
              {r.googleEventId && r.googleRsvps && <p className="muted text-xs">
                RSVP: candidate {r.googleRsvps.candidate ?? "unknown"}
                {r.googleRsvps.interviewers.map((response) =>
                  ` · ${r.interviewers.find((person) => person.id === response.userId)?.name ?? "Interviewer"} ${response.status}`)}
                {r.googleLastSyncedAt && ` · checked ${r.googleLastSyncedAt.toLocaleString()}`}
              </p>}

              {r.status !== "cancelled" && (mine || manage) && (
                <div className="flex flex-wrap items-center gap-2">
                  {(mine || manage) && (
                    <Link href={`/applications/${applicationId}/scorecard?interview=${r.id}`} className="btn btn-secondary">
                      {mine?.submitted ? "Edit your scorecard" : "Submit scorecard"}
                    </Link>
                  )}
                  {manage && (r.status === "to_schedule" || r.status === "scheduled") && (
                    <Link href={`/candidates/${candidateId}/interviews/${r.id}/schedule`} className="btn">
                      {r.scheduledAt ? "Reschedule" : "Schedule manually"}
                    </Link>
                  )}
                  {manage && r.googleSyncError && (
                    <form action={retryCalendarSyncAction.bind(null, r.id)}>
                      <button type="submit" className="btn btn-secondary">Retry calendar sync</button>
                    </form>
                  )}
                  {manage && r.googleEventId && <form action={refreshGoogleEventAction.bind(null, r.id)}>
                    <button type="submit" className="btn btn-secondary">Refresh from Google</button>
                  </form>}
                  {manage && r.status === "to_schedule" && (
                    <>
                      <BookingLinkControl interviewId={r.id} activeLink={r.bookingLinkActive} />
                    </>
                  )}
                  {manage && r.status !== "complete" && (
                    <form action={setInterviewStateAction.bind(null, r.id, "complete")}>
                      <button type="submit" className="btn btn-secondary">
                        Mark as held
                      </button>
                    </form>
                  )}
                  {manage && (
                    <form action={setInterviewStateAction.bind(null, r.id, "cancel")}>
                      <button type="submit" className="btn btn-secondary">
                        Cancel interview
                      </button>
                    </form>
                  )}
                </div>
              )}
              {r.status === "cancelled" && manage && (
                <form action={setInterviewStateAction.bind(null, r.id, "restore")}>
                  <button type="submit" className="link text-xs">
                    Restore
                  </button>
                </form>
              )}

              {manage && r.status !== "cancelled" && (
                <details className="text-sm">
                  <summary className="link w-fit cursor-pointer text-xs">Change interviewers</summary>
                  <div className="inset mt-2 space-y-4">
                    <ActionForm
                      action={setInterviewersAction.bind(null, r.id)}
                      resetKey={r.interviewers.map((i) => i.id).join(",")}
                      className="space-y-2"
                    >
                      <fieldset>
                        <legend className="label">Interviewers</legend>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {people.map((p) => (
                            <label key={p.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                name="interviewerIds"
                                value={p.id}
                                defaultChecked={r.interviewers.some((i) => i.id === p.id)}
                              />
                              {p.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <SubmitButton variant="secondary">Save interviewers</SubmitButton>
                    </ActionForm>
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>

      {manage && active && (
        <details className="mt-3 text-sm">
          <summary className="link w-fit cursor-pointer text-xs">Add a one-off interview</summary>
          <ActionForm action={addInterviewAction.bind(null, applicationId)} className="inset mt-2 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Field label="Interview name" name="name" required placeholder="e.g. Founder chat" />
              <Field label="Minutes" name="durationMinutes" type="number" required defaultValue="45" />
            </div>
            <p className="muted text-xs">Add the interview, then schedule it from this candidate record.</p>
            <fieldset>
              <legend className="label">Interviewers</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-2">
                    <input type="checkbox" name="interviewerIds" value={p.id} />
                    {p.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <SubmitButton variant="secondary">Add interview</SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
