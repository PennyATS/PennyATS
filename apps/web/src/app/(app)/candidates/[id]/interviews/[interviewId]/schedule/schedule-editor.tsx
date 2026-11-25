"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { localInputInZone, overlappingInterviews, parseZonedScheduledAt } from "@/lib/interviews";
import { saveManualScheduleAction } from "@/app/(app)/candidates/interview-actions";

type Interview = {
  id: string;
  name: string;
  stageName: string;
  durationMinutes: number;
  scheduledAt: string | null;
  timeZone: string | null;
  meetingLocation: string | null;
};
type OtherSchedule = {
  interviewId: string;
  interviewerId: string;
  interviewerName: string;
  scheduledAt: string;
  durationMinutes: number;
};
type GooglePreview = {
  calendars: { name: string; busy: { start: string; end: string }[]; unavailable: boolean }[];
  disconnected: string[];
};

function timeLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function nearbySlots(local: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return [];
  const [, year, month, day, hour, minute] = match.map(Number);
  const center = Date.UTC(year, month - 1, day, hour, minute);
  return [-30, 0, 30, 60].map((offset) => new Date(center + offset * 60000).toISOString().slice(0, 16));
}

export function ScheduleEditor({ candidate, jobTitle, interview, interviewers, otherSchedules, willInvite }: {
  candidate: { id: string; name: string; email: string | null };
  jobTitle: string;
  interview: Interview;
  interviewers: { id: string; name: string }[];
  otherSchedules: OtherSchedule[];
  willInvite: boolean;
}) {
  const [timeZone, setTimeZone] = useState(interview.timeZone || "UTC");
  const [local, setLocal] = useState(interview.scheduledAt
    ? localInputInZone(new Date(interview.scheduledAt), interview.timeZone || "UTC") : "");
  const [location, setLocation] = useState(interview.meetingLocation || "");
  const [review, setReview] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [googlePreview, setGooglePreview] = useState<GooglePreview | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (interview.timeZone) return;
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    setTimeZone(browserZone);
    if (interview.scheduledAt) setLocal(localInputInZone(new Date(interview.scheduledAt), browserZone));
  }, [interview.scheduledAt, interview.timeZone]);

  const parsed = useMemo(() => local ? parseZonedScheduledAt(local, timeZone) : null, [local, timeZone]);
  useEffect(() => {
    if (!parsed?.ok || !willInvite) { setGooglePreview(null); return; }
    const controller = new AbortController();
    const start = new Date(parsed.value.getTime() - 2 * 3600000);
    const end = new Date(parsed.value.getTime() + 4 * 3600000);
    const query = new URLSearchParams({ interviewId: interview.id, start: start.toISOString(), end: end.toISOString() });
    setGoogleLoading(true);
    fetch(`/api/google-calendar/freebusy?${query}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<GooglePreview> : Promise.reject())
      .then(setGooglePreview)
      .catch(() => { if (!controller.signal.aborted) setGooglePreview(null); })
      .finally(() => { if (!controller.signal.aborted) setGoogleLoading(false); });
    return () => controller.abort();
  }, [parsed, interview.id, willInvite]);
  const conflicts = useMemo(() => parsed?.ok ? overlappingInterviews(
    parsed.value, interview.durationMinutes, interview.id,
    otherSchedules.map((row) => ({ ...row, scheduledAt: new Date(row.scheduledAt) })),
  ) : [], [parsed, interview.durationMinutes, interview.id, otherSchedules]);
  const end = parsed?.ok ? new Date(parsed.value.getTime() + interview.durationMinutes * 60000) : null;
  const reviewText = parsed?.ok && end
    ? `${interview.name} for ${jobTitle}\n${timeLabel(parsed.value, timeZone)}–${new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(end)} (${timeZone})\nWith ${interviewers.map((p) => p.name).join(", ") || "interviewer to be assigned"}${location ? `\n${location}` : ""}`
    : "";

  function continueToReview() {
    if (!local) return setClientError("Choose a date and time.");
    if (!parsed?.ok) return setClientError(parsed?.error ?? "Choose a valid time.");
    if (parsed.value <= new Date()) return setClientError("Choose a future time.");
    if (conflicts.length) return setClientError("Choose a time without a PennyATS interview conflict.");
    setClientError(null);
    setReview(true);
  }

  return (
    <div className="mt-5 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
            {review ? "Final check" : "Manual scheduling"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{review ? "Review manual schedule" : `Schedule ${interview.name}`}</h1>
          <p className="muted mt-1 text-sm">{candidate.name} · {jobTitle} · {interview.stageName}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border px-3 py-1.5" style={{ borderColor: "var(--border)" }}>01 Choose time</span>
          <span className="muted">→</span>
          <span className="rounded-full border px-3 py-1.5" style={{ borderColor: "var(--border)" }}>02 Review</span>
        </div>
      </header>

      {review ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <section className="card space-y-5">
            <h2 className="text-lg font-semibold">{interview.name}</h2>
            <p className="muted text-sm">Confirm the details before saving this interview.</p>
            <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <p className="muted text-xs font-semibold uppercase tracking-wide">When</p>
              <p className="mt-2 text-lg font-semibold">{parsed?.ok && timeLabel(parsed.value, timeZone)}</p>
              <p className="muted text-sm">{end && new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(end)} · {interview.durationMinutes} minutes · {timeZone}</p>
            </div>
            <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <p className="muted text-xs font-semibold uppercase tracking-wide">Attendees</p>
              <p className="mt-2 text-sm">{candidate.name} · candidate</p>
              {interviewers.map((person) => <p key={person.id} className="text-sm">{person.name} · interviewer</p>)}
              {!interviewers.length && <p className="muted mt-2 text-sm">No interviewer assigned yet.</p>}
            </div>
            <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <p className="muted text-xs font-semibold uppercase tracking-wide">Meeting</p>
              <p className="mt-2 text-sm">{location || "No link or location added"}</p>
            </div>
            <p className="muted rounded-lg p-3 text-xs" style={{ background: "var(--bg)" }}>
              {willInvite
                ? "Saving also sends Google Calendar invitations. If Google is unavailable, the interview stays saved and a retry action appears on the candidate profile."
                : "This saves the interview in PennyATS. No calendar invitation or email is sent; share the details manually."}
            </p>
            <ActionForm action={saveManualScheduleAction.bind(null, interview.id)} className="space-y-3">
              <input type="hidden" name="scheduledLocal" value={local} />
              <input type="hidden" name="timeZone" value={timeZone} />
              <input type="hidden" name="meetingLocation" value={location} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" onClick={() => setReview(false)}>Back to calendar</button>
                <SubmitButton>Save interview</SubmitButton>
              </div>
            </ActionForm>
          </section>
          <section className="card space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Details to share with {candidate.name}</h2>
              <span className="rounded-full px-3 py-1 text-xs" style={{ background: "#e0f1e6", color: "#14533b" }}>{willInvite ? "Calendar invite" : "Manual copy"}</span>
            </div>
            <p className="muted text-sm">Preview the details before sharing them outside PennyATS.</p>
            <div className="inset space-y-4 text-sm" style={{ background: "var(--bg)" }}>
              <p className="muted">To: {candidate.email || "Candidate email not on file"}</p>
              <h3 className="text-xl font-semibold">{interview.name} · {jobTitle}</h3>
              <p>Hi {candidate.name.split(" ")[0]}, we’re looking forward to meeting you.</p>
              <p className="whitespace-pre-line">{reviewText}</p>
            </div>
            <button type="button" className="btn btn-secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(`Hi ${candidate.name.split(" ")[0]},\n\n${reviewText}`); setCopied(true); }
              catch { setCopied(false); }
            }}>{copied ? "Copied details" : "Copy details"}</button>
          </section>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <section className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Interviewer schedule</h2>
              <p className="muted text-xs">PennyATS interviews{willInvite ? " and Google free/busy" : " only · no connected Google Calendar"}</p>
            </div>
            <p className="muted text-sm">Choose a time. Busy slots show interviews already recorded in PennyATS.</p>
            {local ? <div className="space-y-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <div className="grid gap-2 text-xs font-semibold sm:grid-cols-[7rem_repeat(2,minmax(0,1fr))]">
                <span>Time</span><span>Selected interview</span><span>Assigned interviewers</span>
              </div>
              {nearbySlots(local).map((slot) => {
                const at = parseZonedScheduledAt(slot, timeZone);
                if (!at.ok) return null;
                const busy = overlappingInterviews(at.value, interview.durationMinutes, interview.id,
                  otherSchedules.map((row) => ({ ...row, scheduledAt: new Date(row.scheduledAt) })));
                const googleBusy = googlePreview?.calendars.filter((calendar) => calendar.busy.some((interval) =>
                  new Date(interval.start).getTime() < at.value.getTime() + interview.durationMinutes * 60000 &&
                  new Date(interval.end).getTime() > at.value.getTime())) ?? [];
                const chosen = slot === local;
                return <button key={slot} type="button" onClick={() => { setLocal(slot); setClientError(null); }}
                  className="grid w-full gap-2 border-t py-3 text-left text-sm sm:grid-cols-[7rem_repeat(2,minmax(0,1fr))]"
                  style={{ borderColor: "var(--border)" }}>
                  <span className="muted">{new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(at.value)}</span>
                  <span className={`rounded-md px-3 py-2 ${chosen ? "font-semibold" : ""}`}
                    style={{ background: chosen ? "#e0f1e6" : "var(--bg)", color: chosen ? "#14533b" : "var(--text)" }}>
                    {chosen ? "Selected" : "Choose this time"}
                  </span>
                  <span className="rounded-md px-3 py-2" style={{ background: busy.length ? "#fff4db" : "var(--bg)", color: busy.length ? "#7a5011" : "var(--text)" }}>
                    {busy.length ? `PennyATS busy · ${[...new Set(busy.map((row) => row.interviewerName))].join(", ")}`
                      : googleBusy.length ? `Google busy · ${googleBusy.map((row) => row.name).join(", ")}` : "Open in PennyATS"}
                  </span>
                </button>;
              })}
            </div> : <div className="inset muted text-sm">Pick a date and time to see nearby PennyATS interview slots.</div>}
          </section>
          <section className="card space-y-4 self-start">
            <h2 className="text-lg font-semibold">Interview details</h2>
            <p className="muted text-sm">{candidate.name} · {jobTitle}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t pt-4 text-sm" style={{ borderColor: "var(--border)" }}>
              <dt className="muted">Interview</dt><dd className="text-right">{interview.name}</dd>
              <dt className="muted">Interviewers</dt><dd className="text-right">{interviewers.map((p) => p.name).join(", ") || "None assigned"}</dd>
              <dt className="muted">Duration</dt><dd className="text-right">{interview.durationMinutes} minutes</dd>
            </dl>
            <div><label className="label" htmlFor="scheduled-local">Date and time</label>
              <input id="scheduled-local" type="datetime-local" className="input" value={local} onChange={(e) => { setLocal(e.target.value); setClientError(null); }} />
            </div>
            <div><label className="label" htmlFor="time-zone">Time zone</label>
              <input id="time-zone" list="scheduling-time-zones" className="input" value={timeZone} onChange={(e) => { setTimeZone(e.target.value); setClientError(null); }} />
              <datalist id="scheduling-time-zones">
                {["UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"].map((zone) => <option key={zone} value={zone} />)}
              </datalist>
            </div>
            <div><label className="label" htmlFor="meeting-location">Meeting link or location</label>
              <input id="meeting-location" className="input" maxLength={500} value={location} placeholder="Video link or address" onChange={(e) => setLocation(e.target.value)} />
            </div>
            {parsed && !parsed.ok && <p role="alert" className="error text-sm">{parsed.error}</p>}
            {conflicts.length > 0 && <div role="alert" className="rounded-lg border p-3 text-sm" style={{ borderColor: "#ebd29b", background: "#fff4db", color: "#754d13" }}>
              <p className="font-semibold">PennyATS interview conflict</p>
              <p className="mt-1">{[...new Set(conflicts.map((row) => row.interviewerName))].join(", ")} already has an interview at this time. Choose an open slot.</p>
            </div>}
            {googleLoading && <p className="muted text-xs">Checking Google Calendar availability…</p>}
            {googlePreview?.calendars.some((calendar) => calendar.unavailable) &&
              <p role="alert" className="error text-xs">A connected calendar could not be checked. Scheduling can still be saved manually.</p>}
            {parsed?.ok && !conflicts.length && <p className="rounded-lg p-3 text-sm" style={{ background: "#e7f4eb", color: "#14533b" }}>No PennyATS interview conflict at this time.</p>}
            {clientError && <p role="alert" className="error text-sm">{clientError}</p>}
            <button type="button" className="btn" onClick={continueToReview}>Review interview →</button>
          </section>
        </div>
      )}
    </div>
  );
}
