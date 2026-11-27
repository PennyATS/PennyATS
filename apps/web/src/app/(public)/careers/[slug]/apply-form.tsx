"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Field, SubmitButton, type FormAction } from "@/components/form";

type Notice = { text: string | null; url: string | null; requireConsent: boolean };

export function ApplyForm({
  action,
  notice,
  maxResume,
  jobId,
}: {
  action: FormAction;
  notice: Notice;
  maxResume: string;
  jobId: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const started = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const hintId = useId();
  const errorId = useId();

  function markStart() {
    if (started.current) return;
    started.current = true;
    void fetch("/api/careers/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, kind: "start" }),
      keepalive: true,
    });
  }

  useEffect(() => {
    if (state?.error) errorRef.current?.focus();
  }, [state?.error]);

  if (state?.message) {
    return (
      <section className="card space-y-2" aria-labelledby="apply-thanks-title">
        <h3 id="apply-thanks-title" className="text-lg font-semibold tracking-tight">
          Application received
        </h3>
        <p role="status">{state.message}</p>
      </section>
    );
  }

  const describedBy = state?.error ? `${hintId} ${errorId}` : hintId;

  return (
    <form
      action={formAction}
      className="card space-y-5"
      onFocus={markStart}
      aria-describedby={describedBy}
    >
      <p id={hintId} className="muted text-sm">
        No account needed. Fields marked with an asterisk are required.
      </p>

      {state?.error && (
        <p
          ref={errorRef}
          id={errorId}
          role="alert"
          tabIndex={-1}
          className="error rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm outline-none"
        >
          {state.error}
        </p>
      )}

      <fieldset className="space-y-4 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Your details</legend>
        <Field label="Full name" name="fullName" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
        <Field label="LinkedIn URL" name="linkedinUrl" type="url" placeholder="https://www.linkedin.com/in/..." />
        <Field label="Location" name="location" autoComplete="address-level2" />
      </fieldset>

      <fieldset className="space-y-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Resume</legend>
        <div>
          <label className="label" htmlFor="resume">
            Upload a file (PDF, DOC, DOCX, TXT or RTF, up to {maxResume})
          </label>
          <input
            id="resume"
            name="resume"
            type="file"
            accept=".pdf,.doc,.docx,.txt,.rtf"
            className="careers-file"
          />
        </div>
      </fieldset>

      {/* Honeypot for bots. Hidden from people and screen readers. */}
      <div aria-hidden="true" className="careers-honeypot">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {(notice.text || notice.url) && (
        <div className="muted space-y-1 text-sm">
          {notice.text && <p className="whitespace-pre-wrap">{notice.text}</p>}
          {notice.url && (
            <p>
              <a href={notice.url} className="link" target="_blank" rel="noopener noreferrer">
                Privacy policy
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          )}
        </div>
      )}

      {notice.requireConsent && (
        <label className="careers-consent flex items-start gap-3 text-sm">
          <input type="checkbox" name="consent" required className="careers-consent-input mt-1" />
          <span>I have read the privacy notice and agree to my information being used to consider my application.</span>
        </label>
      )}

      <SubmitButton>Submit application</SubmitButton>
    </form>
  );
}
