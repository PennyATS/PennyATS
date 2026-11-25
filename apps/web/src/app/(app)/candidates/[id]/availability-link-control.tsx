"use client";

import { useActionState, useState } from "react";
import { manageAvailabilityLinkAction } from "../interview-actions";

export function AvailabilityLinkControl({ applicationId, activeLink }: { applicationId: string; activeLink: boolean }) {
  const [state, action, pending] = useActionState(manageAvailabilityLinkAction.bind(null, applicationId), undefined);
  const [copied, setCopied] = useState(false);
  return <div className="mt-3 flex flex-wrap items-center gap-2">
    <form action={action} className="flex flex-wrap gap-2">
      <button type="submit" name="intent" value="create" className="btn btn-secondary" disabled={pending}>
        {activeLink ? "Replace availability link" : "Request availability"}
      </button>
      {(activeLink || state?.url) && !state?.message && <button type="submit" name="intent" value="revoke"
        className="btn btn-secondary" disabled={pending}>Revoke link</button>}
    </form>
    {state?.url && <button type="button" className="btn btn-secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(state.url!); setCopied(true); }
      catch { setCopied(false); }
    }}>{copied ? "Copied link" : "Copy link"}</button>}
    {state?.url && <input readOnly aria-label="Availability link" className="input min-w-0 basis-full text-xs" value={state.url} onFocus={(event) => event.currentTarget.select()} />}
    {state?.error && <p role="alert" className="error text-xs">{state.error}</p>}
    {state?.message && <p role="status" className="muted text-xs">{state.message}</p>}
  </div>;
}
