"use client";

import { useActionState, useEffect, useState } from "react";
import { submitAvailabilityAction } from "./actions";

type WindowInput = { start: string; end: string };

export function AvailabilityForm({ token, source, candidateName, jobTitle, stageName }: {
  token: string; source: "availability_link" | "booking_fallback";
  candidateName: string; jobTitle: string; stageName: string;
}) {
  const [zone, setZone] = useState("UTC");
  const [windows, setWindows] = useState<WindowInput[]>([{ start: "", end: "" }]);
  const [state, action, pending] = useActionState(submitAvailabilityAction.bind(null, token, source), undefined);
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), []);
  const change = (index: number, key: keyof WindowInput, value: string) =>
    setWindows((current) => current.map((window, i) => i === index ? { ...window, [key]: value } : window));
  return <main className="min-h-screen px-4 py-10 sm:py-16" style={{ background: "var(--bg)" }}>
    <div className="mx-auto max-w-xl space-y-6">
      <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>PennyATS · Interview scheduling</p>
      <header>
        <p className="muted text-sm">{jobTitle} · {stageName}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{state?.submitted ? "Availability sent" : "Share times that work"}</h1>
        <p className="muted mt-2 text-sm">{candidateName}, add a few windows when you could interview. You can add several on the same day.</p>
      </header>
      {state?.submitted ? <section className="card space-y-2">
        <p className="font-semibold">Thanks for sharing your availability.</p>
        <p className="muted text-sm">The recruiter can see your suggested windows and will coordinate the interviews.</p>
      </section> : <form action={action} className="space-y-5">
        <section className="card space-y-4">
          <div><label htmlFor="availability-zone" className="label">Your time zone</label>
            <input id="availability-zone" name="timeZone" className="input" list="availability-zones" value={zone}
              onChange={(event) => setZone(event.target.value)} required />
            <datalist id="availability-zones">{["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"].map((item) => <option key={item} value={item} />)}</datalist>
          </div>
          <input type="hidden" name="windows" value={JSON.stringify(windows)} />
          <div className="space-y-3">
            {windows.map((window, index) => <div key={index} className="inset space-y-3">
              <div className="flex items-center justify-between"><h2 className="font-semibold">Window {index + 1}</h2>
                {windows.length > 1 && <button type="button" className="link text-xs" onClick={() => setWindows((current) => current.filter((_, i) => i !== index))}>Remove</button>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label htmlFor={`available-start-${index}`} className="label">From</label>
                  <input id={`available-start-${index}`} type="datetime-local" className="input" required value={window.start}
                    onChange={(event) => change(index, "start", event.target.value)} /></div>
                <div><label htmlFor={`available-end-${index}`} className="label">Until</label>
                  <input id={`available-end-${index}`} type="datetime-local" className="input" required value={window.end}
                    onChange={(event) => change(index, "end", event.target.value)} /></div>
              </div>
            </div>)}
          </div>
          {windows.length < 12 && <button type="button" className="btn btn-secondary" onClick={() => setWindows((current) => [...current, { start: "", end: "" }])}>Add another window</button>}
        </section>
        {state?.error && <p role="alert" className="error text-sm">{state.error}</p>}
        <button type="submit" className="btn w-full" disabled={pending}>{pending ? "Sending…" : "Send availability"}</button>
        <p className="muted text-center text-xs">These are suggestions. Your recruiter will confirm the final interview time.</p>
      </form>}
    </div>
  </main>;
}
