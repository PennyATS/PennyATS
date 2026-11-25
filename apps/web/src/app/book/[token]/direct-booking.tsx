"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { confirmBookingAction } from "./actions";

type Slot = { start: string };

function label(date: Date, zone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, { timeZone: zone, ...options }).format(date);
}

export function DirectBooking({ token, candidateName, interviewerName, interviewName, jobTitle,
  durationMinutes, confirmedAt, pendingAt }: {
  token: string; candidateName: string; interviewerName: string; interviewName: string;
  jobTitle: string; durationMinutes: number; confirmedAt: string | null; pendingAt: string | null;
}) {
  const [zone, setZone] = useState("UTC");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(!confirmedAt && !pendingAt);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, action, submitting] = useActionState(confirmBookingAction.bind(null, token), undefined);
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);
  useEffect(() => {
    if (confirmedAt || pendingAt || state?.confirmedAt || state?.pendingAt) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/book/${token}/slots`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Available times could not be loaded. Try again shortly.");
        return response.json() as Promise<{ slots: Slot[] }>;
      })
      .then((data) => { setSlots(data.slots); setLoadError(null); })
      .catch((error) => { if (!controller.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, confirmedAt, pendingAt, state?.confirmedAt, state?.pendingAt]);
  const days = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots) {
      const day = label(new Date(slot.start), zone, { weekday: "long", month: "short", day: "numeric" });
      grouped.set(day, [...(grouped.get(day) ?? []), slot]);
    }
    return [...grouped.entries()];
  }, [slots, zone]);
  const finalTime = state?.confirmedAt ?? confirmedAt;
  const heldTime = state?.pendingAt ?? pendingAt;
  return <main className="min-h-screen px-4 py-10 sm:py-16" style={{ background: "var(--bg)" }}>
    <div className="mx-auto max-w-xl space-y-6">
      <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>PennyATS · Interview scheduling</p>
      <header>
        <p className="muted text-sm">{jobTitle}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{finalTime ? "Interview confirmed" : heldTime ? "Time held" : "Choose your interview time"}</h1>
        <p className="muted mt-2 text-sm">{candidateName}, meet with {interviewerName} for {interviewName} · {durationMinutes} minutes.</p>
      </header>
      {finalTime ? <section className="card space-y-3">
        <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>You’re booked</p>
        <p className="text-xl font-semibold">{label(new Date(finalTime), zone, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</p>
        <p className="muted text-sm">A Google Calendar invitation was sent to you and your interviewer.</p>
      </section> : heldTime ? <section className="card space-y-3">
        <p className="text-lg font-semibold">Your time is held</p>
        <p>{label(new Date(heldTime), zone, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</p>
        <p className="muted text-sm">The calendar invitation could not be sent yet. The recruiter can retry from PennyATS.</p>
      </section> : <>
        <section className="card space-y-4">
          <div><label className="label" htmlFor="candidate-zone">Your time zone</label>
            <input id="candidate-zone" className="input" list="booking-zones" value={zone}
              onChange={(event) => setZone(event.target.value)} />
            <datalist id="booking-zones">{["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"].map((item) => <option key={item} value={item} />)}</datalist>
          </div>
          {loading && <p role="status" className="muted text-sm">Checking available times…</p>}
          {loadError && <p role="alert" className="error text-sm">{loadError}</p>}
          {!loading && !loadError && !days.length && <p className="muted text-sm">No available times in the next two weeks. Ask your recruiter for another option.</p>}
          {days.map(([day, times]) => <div key={day} className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h2 className="font-semibold">{day}</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {times.map((slot) => <button type="button" key={slot.start} onClick={() => setSelected(slot.start)}
                aria-pressed={selected === slot.start}
                className={`rounded-lg border px-3 py-2 text-sm ${selected === slot.start ? "font-semibold" : ""}`}
                style={{ borderColor: selected === slot.start ? "var(--accent)" : "var(--border)",
                  background: selected === slot.start ? "#e0f1e6" : "var(--surface)" }}>
                {label(new Date(slot.start), zone, { hour: "numeric", minute: "2-digit" })}
              </button>)}
            </div>
          </div>)}
        </section>
        {selected && <form action={action} className="card space-y-3">
          <h2 className="font-semibold">Confirm this time</h2>
          <p className="text-sm">{label(new Date(selected), zone, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</p>
          <input type="hidden" name="slot" value={selected} />
          <input type="hidden" name="timeZone" value={zone} />
          {state?.error && <p role="alert" className="error text-sm">{state.error}</p>}
          <button type="submit" className="btn w-full" disabled={submitting}>{submitting ? "Confirming…" : "Confirm interview"}</button>
        </form>}
        <p className="muted text-center text-sm"><Link className="link" href={`/book/${token}/suggest`}>None of these times work? Suggest times instead</Link></p>
      </>}
    </div>
  </main>;
}
