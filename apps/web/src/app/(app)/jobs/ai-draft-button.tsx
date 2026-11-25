"use client";

import { useRef, useState, useTransition } from "react";

type DraftAction = (input: {
  title: string;
  department: string;
  location: string;
  notes: string;
}) => Promise<{ text: string } | { error: string }>;

/**
 * Fills the job description with an AI draft. Whatever is already in the box is sent as
 * notes, then replaced; "Undo" puts it back. Only rendered when the feature is on.
 */
export function AiDraftButton({ action }: { action: DraftAction }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  function field(name: string): HTMLInputElement | HTMLTextAreaElement | null {
    return ref.current?.closest("form")?.querySelector(`[name="${name}"]`) ?? null;
  }

  function draft() {
    const description = field("description");
    if (!description) return;
    setError(null);
    startTransition(async () => {
      const result = await action({
        title: field("title")?.value ?? "",
        department: field("department")?.value ?? "",
        location: field("location")?.value ?? "",
        notes: description.value,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPrevious(description.value);
      description.value = result.text;
    });
  }

  function undo() {
    const description = field("description");
    if (description && previous !== null) description.value = previous;
    setPrevious(null);
  }

  return (
    <div ref={ref} className="mt-1 flex flex-wrap items-center gap-3 text-xs">
      <button type="button" className="link" onClick={draft} disabled={pending}>
        {pending ? "Drafting..." : "Draft with AI"}
      </button>
      {previous !== null && !pending && (
        <button type="button" className="link" onClick={undo}>
          Undo draft
        </button>
      )}
      <span className="muted">Uses the title, department, location, and anything already in the box as notes. Review before publishing.</span>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </div>
  );
}
