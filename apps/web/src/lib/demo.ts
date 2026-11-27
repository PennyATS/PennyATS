// Public demo mode (#10). Set DEMO_MODE=true only on a throwaway instance loaded with the
// synthetic seed. It switches off everything that reaches the outside world or costs money
// (email, AI, calendar sync, webhooks), tightens rate limits and uploads, blocks account
// takeovers, and shows a banner telling visitors not to enter real data.
// No Next.js imports, so scripts and pure tests can use it.

export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEMO_MODE === "true";
}

/** Limits that apply on the demo instead of the normal ones. */
export const DEMO_LIMITS = {
  /** Resume uploads: small, so the disk can't be filled between resets. */
  resumeMaxBytes: 512 * 1024,
  /** Public applications per IP an hour. */
  applyPerHour: 3,
  /** Sign-in attempts per IP and email per 15 minutes. */
  loginPer15Min: 10,
  /** Public API requests per key a minute. */
  apiPerMinute: 30,
} as const;

/** How often the demo resets, shown in the banner. Matches DEMO_RESET_HOURS in the reset service. */
export function demoResetHours(env: Record<string, string | undefined> = process.env): number {
  const hours = Number(env.DEMO_RESET_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours : 6;
}

/** Shown when a visitor tries something the demo blocks. */
export const DEMO_BLOCKED = "This is disabled on the public demo. Install your own copy to try it.";

/** The demo login, shown on the sign-in page. These are the seed's synthetic accounts. */
export const DEMO_LOGINS = [
  { role: "Admin", email: "admin@example.com" },
  { role: "Recruiter", email: "recruiter@example.com" },
] as const;
export const DEMO_PASSWORD = "pennyats-demo";
