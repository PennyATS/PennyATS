"use client";

import { useActionState } from "react";
import { Field, SubmitButton, type FormAction } from "@/components/form";

type Notice = { text: string | null; url: string | null; requireConsent: boolean };

export function ApplyForm({ action, notice }: { action: FormAction; notice: Notice }) {
  const [state, formAction] = useActionState(action, undefined);

  if (state?.message) {
    return (
      <p role="status" className="card">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="card space-y-4">
      <Field label="Full name" name="fullName" autoComplete="name" required />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
      <Field label="LinkedIn URL" name="linkedinUrl" type="url" placeholder="https://www.linkedin.com/in/..." />
      <Field label="Location" name="location" autoComplete="address-level2" />
      <div>
        <label className="label" htmlFor="resume">
          Resume (PDF, DOC, DOCX, TXT or RTF, up to 5 MB)
        </label>
        <input
          id="resume"
          name="resume"
          type="file"
          accept=".pdf,.doc,.docx,.txt,.rtf"
          className="text-sm"
        />
      </div>
      {/* Honeypot for bots. Hidden from people and screen readers. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}>
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
              </a>
            </p>
          )}
        </div>
      )}
      {notice.requireConsent && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" required className="mt-1" />
          I have read the privacy notice and agree to my information being used to consider my application.
        </label>
      )}
      {state?.error && (
        <p role="alert" className="error text-sm">
          {state.error}
        </p>
      )}
      <SubmitButton>Submit application</SubmitButton>
    </form>
  );
}
