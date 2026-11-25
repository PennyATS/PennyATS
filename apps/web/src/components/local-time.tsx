"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shows a moment in the viewer's own timezone. The server doesn't know it, so the text is
 * filled in after the page loads (a plain date in UTC until then).
 */
export function LocalTime({ iso, withTime = true }: { iso: string; withTime?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(iso);
    setText(
      withTime
        ? d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    );
  }, [iso, withTime]);
  return <time dateTime={iso}>{text ?? iso.slice(0, 10)}</time>;
}

/**
 * A date-and-time input that sends the browser's UTC offset alongside it, so the server can
 * store the exact moment the user meant (see parseScheduledAt). Pre-filled in local time.
 */
export function ScheduleInput({ id, value }: { id: string; value: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const offset = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (offset.current) offset.current.value = String(new Date().getTimezoneOffset());
    if (input.current && value) {
      const d = new Date(value);
      const pad = (n: number) => String(n).padStart(2, "0");
      input.current.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }, [value]);
  return (
    <>
      <input ref={input} id={id} type="datetime-local" name="scheduledAt" className="input w-auto" />
      <input ref={offset} type="hidden" name="tzOffset" defaultValue="0" />
    </>
  );
}
