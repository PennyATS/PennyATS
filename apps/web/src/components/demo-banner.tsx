import { demoResetHours, isDemoMode } from "@/lib/demo";

/** Shown on every page of the public demo (DEMO_MODE=true), signed in or not. */
export function DemoBanner() {
  if (!isDemoMode()) return null;
  return (
    <div
      role="note"
      className="border-b px-4 py-2 text-center text-sm"
      style={{ background: "var(--warn-bg)", borderColor: "var(--warn-border)", color: "var(--warn-text)" }}
    >
      <strong>Public demo with fictional data.</strong> Do not enter real names, emails, or resumes. Anyone can see
      what you type, and everything resets every {demoResetHours()} hours. Email, AI, calendar sync, and webhooks are off.
    </div>
  );
}
