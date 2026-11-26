"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/form";

export type SecretState = { error?: string; secret?: string; label?: string } | undefined;

/** A form whose action returns a secret to show exactly once, with a copy button. */
export function SecretForm({
  action,
  submitLabel,
  children,
}: {
  action: (state: SecretState, form: FormData) => Promise<SecretState>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <form action={formAction} className="card mt-3 max-w-3xl space-y-4">
      {children}
      <SubmitButton>{submitLabel}</SubmitButton>
      {state?.error && (
        <p role="alert" className="error text-sm">
          {state.error}
        </p>
      )}
      {state?.secret && (
        <div role="status" className="space-y-2 text-sm">
          <p>{state.label}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code data-testid="new-secret" className="input w-auto max-w-full select-all overflow-x-auto font-mono text-xs">
              {state.secret}
            </code>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(state.secret ?? "").then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
