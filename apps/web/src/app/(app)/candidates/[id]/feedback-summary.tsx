"use client";

import { useState, useTransition } from "react";

/** Button that asks the AI to summarize this application's scorecards. The result isn't saved. */
export function FeedbackSummary({ action }: { action: () => Promise<{ text: string } | { error: string }> }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ text: string } | { error: string } | null>(null);

  return (
    <div className="mt-2">
      <button
        type="button"
        className="link"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await action()))}
      >
        {pending ? "Summarizing..." : result && "text" in result ? "Summarize again" : "Summarize feedback with AI"}
      </button>
      {result && "error" in result && (
        <p role="alert" className="error mt-1">
          {result.error}
        </p>
      )}
      {result && "text" in result && (
        <div className="mt-2 rounded-md border p-3" style={{ borderColor: "var(--border)" }}>
          <p className="muted mb-1 text-xs">AI summary. Check it against the scorecards before relying on it.</p>
          <p className="whitespace-pre-wrap">{result.text}</p>
        </div>
      )}
    </div>
  );
}
