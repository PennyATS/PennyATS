// First-run setup checklist (#132). Pure rules: which steps exist, what they say, and whether
// each is done, skipped, or still to do. Completion is derived from the workspace itself
// (a job exists, SMTP is configured, ...); only skips and "dismissed" are stored.
// Data loading lives in setup-checklist-data.ts.

export const SETUP_STEP_IDS = ["company", "job", "email", "calendar", "ai", "team"] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStep = {
  id: SetupStepId;
  title: string;
  /** What it is for, in plain language. */
  why: string;
  /** How to do it, in plain language. Technical terms are explained where they appear. */
  how: string;
  /** Where to do it. */
  href: string;
  linkLabel: string;
  optional: boolean;
  /** Has a Test button. */
  testable: boolean;
};

export const SETUP_STEPS: readonly SetupStep[] = [
  {
    id: "company",
    title: "Name your company",
    why: "Your company name appears in emails to candidates and on your careers page, the public page where people find your jobs and apply.",
    how: "Type your company name and save it.",
    href: "/settings/email#company-title",
    linkLabel: "Set company name",
    optional: false,
    testable: false,
  },
  {
    id: "job",
    title: "Create your first job",
    why: "A job holds its own hiring steps (stages), team, and candidates. Open jobs appear on your careers page.",
    how: "Add a title and description. The usual stages are filled in for you and you can change them later.",
    href: "/jobs/new",
    linkLabel: "Create a job",
    optional: false,
    testable: false,
  },
  {
    id: "email",
    title: "Connect email",
    why: "Lets PennyATS send interview invitations, scheduling links, team invites, and password resets. Without it you copy links by hand.",
    how: "Email is sent through an outgoing mail service you already have or sign up for, such as Postmark, SendGrid, Amazon SES, or your Google Workspace account. That service gives you SMTP settings (SMTP is the standard way apps hand email to a mail service): a server address, a port, a username, and a password. Add them to your host's settings as SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM (the address emails come from), restart the app, then press Test.",
    href: "/settings/email",
    linkLabel: "Email settings",
    optional: false,
    testable: true,
  },
  {
    id: "calendar",
    title: "Connect your calendar",
    why: "Lets PennyATS check when interviewers are free and put interviews on their Google Calendar.",
    how: "Click Connect on the calendar page and approve access in Google's window. This uses OAuth, which means Google asks you to approve access and PennyATS never sees your Google password. Before that, your host needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from a free Google Cloud project; the Scheduling section of the PennyATS README walks through it.",
    href: "/settings/calendar",
    linkLabel: "Calendar settings",
    optional: true,
    testable: true,
  },
  {
    id: "ai",
    title: "Turn on AI (optional)",
    why: "AI can draft job descriptions and summarize interview feedback. It is off unless you add your own key, and you pay the AI company directly for what you use.",
    how: "Create an API key (a password for apps) with Anthropic or OpenAI. Add it to your host's settings as AI_PROVIDER (anthropic or openai) and AI_API_KEY, restart the app, then press Test. Emails, phone numbers, and links are removed before text is sent, but names are not.",
    href: "/settings/ai",
    linkLabel: "AI settings",
    optional: true,
    testable: true,
  },
  {
    id: "team",
    title: "Invite your team",
    why: "Recruiters and hiring managers can move candidates along. Interviewers only see the jobs they are on and fill in feedback.",
    how: "Enter a teammate's email and pick a role. You get a link to send them; it is emailed for you once email is connected.",
    href: "/settings/users",
    linkLabel: "Invite people",
    optional: false,
    testable: false,
  },
];

/** What the workspace already has, read from the database and server settings. */
export type SetupFacts = Record<SetupStepId, boolean>;

/** What the admin chose: steps skipped, and whether the checklist was hidden from Home. */
export type ChecklistState = { skipped: SetupStepId[]; dismissed: boolean };

export const EMPTY_CHECKLIST: ChecklistState = { skipped: [], dismissed: false };

export function isSetupStepId(value: unknown): value is SetupStepId {
  return typeof value === "string" && (SETUP_STEP_IDS as readonly string[]).includes(value);
}

/** Parse the stored value defensively; unknown keys and bad values are dropped. */
export function readChecklistState(value: unknown): ChecklistState {
  if (!value || typeof value !== "object") return EMPTY_CHECKLIST;
  const v = value as { skipped?: unknown; dismissed?: unknown };
  const skipped = Array.isArray(v.skipped) ? [...new Set(v.skipped.filter(isSetupStepId))] : [];
  return { skipped, dismissed: v.dismissed === true };
}

export function skipStep(state: ChecklistState, id: SetupStepId): ChecklistState {
  return state.skipped.includes(id) ? state : { ...state, skipped: [...state.skipped, id] };
}

export function unskipStep(state: ChecklistState, id: SetupStepId): ChecklistState {
  return { ...state, skipped: state.skipped.filter((s) => s !== id) };
}

export type StepStatus = "done" | "skipped" | "todo";

export function checklistSteps(facts: SetupFacts, state: ChecklistState) {
  return SETUP_STEPS.map((step) => ({
    ...step,
    status: (facts[step.id] ? "done" : state.skipped.includes(step.id) ? "skipped" : "todo") as StepStatus,
  }));
}

export function checklistSummary(steps: { status: StepStatus }[]) {
  const done = steps.filter((s) => s.status === "done").length;
  const settled = steps.filter((s) => s.status !== "todo").length;
  return { done, total: steps.length, finished: settled === steps.length };
}

/** Home shows the checklist to admins until every step is done or skipped, or they hide it. */
export function showChecklistOnHome(isAdmin: boolean, steps: { status: StepStatus }[], state: ChecklistState): boolean {
  return isAdmin && !state.dismissed && !checklistSummary(steps).finished;
}

export type TestOutcome = "ok" | "not_configured" | "failed" | "not_connected" | "rate_limited";

/** Plain-language results for the Test buttons. */
export function testMessage(step: "email" | "calendar" | "ai", outcome: TestOutcome): { ok: boolean; text: string } {
  const messages: Record<typeof step, Partial<Record<TestOutcome, string>>> = {
    email: {
      ok: "Email works. PennyATS reached your mail service and logged in.",
      not_configured: "Email is not set up yet. Add the SMTP settings from your mail service to your host's settings, restart the app, and test again.",
      failed: "PennyATS could not log in to your mail service. Check the server address, port, username, and password from your mail service, and that the From address is one it lets you send from.",
    },
    calendar: {
      ok: "Your calendar works. PennyATS can see when you are free.",
      not_configured: "Calendar connection is not available on this server yet. Your host needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; the Scheduling section of the PennyATS README explains how to get them.",
      not_connected: "Your Google Calendar is not connected yet. Open the calendar page and click Connect.",
      failed: "PennyATS could not read your calendar. Disconnect and connect again, and make sure you allowed calendar access in Google's window.",
    },
    ai: {
      ok: "AI works. The model answered a short test question.",
      not_configured: "AI is off because no key was added. That is fine; everything else works without it. To turn it on, add AI_PROVIDER and AI_API_KEY to your host's settings and restart the app.",
      rate_limited: "Too many AI tests in the last hour. Try again later.",
      failed: "The AI company turned the request down. Check that the key is correct and that your account with them has billing set up.",
    },
  };
  const text = messages[step][outcome] ?? messages[step].failed!;
  return { ok: outcome === "ok", text };
}
