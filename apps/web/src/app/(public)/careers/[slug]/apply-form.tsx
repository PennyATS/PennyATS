"use client";

import { useActionState } from "react";
import { Field, SubmitButton, type FormAction } from "@/components/form";

export function ApplyForm({ action }: { action: FormAction }) {
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
      {state?.error && (
        <p role="alert" className="error text-sm">
          {state.error}
        </p>
      )}
      <SubmitButton>Submit application</SubmitButton>
    </form>
  );
}
