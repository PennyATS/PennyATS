"use client";

import { Fragment, useActionState } from "react";
import { useFormStatus } from "react-dom";

export type FormState = { error?: string; message?: string } | undefined;
export type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * A form that shows the error or success message its server action returns.
 *
 * React 19 resets a form after its action runs, which puts inputs back to their old
 * defaults. Pass `resetKey` (e.g. the saved value or an updated-at time) to re-mount just
 * the fields with the new values while keeping the success message.
 */
export function ActionForm({
  action,
  children,
  className = "space-y-4",
  resetKey,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  resetKey?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      <Fragment key={resetKey}>{children}</Fragment>
      {state?.error && (
        <p role="alert" className="error text-sm">
          {state.error}
        </p>
      )}
      {state?.message && (
        <p role="status" className="text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={variant === "primary" ? "btn" : "btn btn-secondary"}
    >
      {pending ? "Working..." : children}
    </button>
  );
}

export function Field({
  id,
  label,
  name,
  type = "text",
  required,
  defaultValue,
  autoComplete,
  placeholder,
}: {
  id?: string;
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | null;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={id ?? name}>
        {label}
        {required && " *"}
      </label>
      <input
        id={id ?? name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? undefined}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="input"
      />
    </div>
  );
}
