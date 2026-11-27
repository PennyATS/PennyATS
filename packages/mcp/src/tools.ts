/**
 * The tools an agent gets. Each one calls the PennyATS API with the configured key, so the key's
 * scopes and its user's role decide what actually works.
 *
 * Safety:
 * - kind "read" tools are always available. "write" and "destructive" tools exist only when the
 *   server runs in read-write mode (off by default).
 * - "destructive" tools (reject, send email, delete) do nothing unless called with confirm: true.
 *   Without it they return a preview of exactly what would happen, so the agent can show the
 *   person and ask first.
 */
import { z } from "zod";
import { PennyClient, seg } from "./client.js";

export type ToolKind = "read" | "write" | "destructive";

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  input: z.ZodRawShape;
  run: (client: PennyClient, args: any) => Promise<unknown>;
  /** Destructive tools only: what would happen, shown when confirm isn't true. */
  preview?: (client: PennyClient, args: any) => Promise<unknown>;
};

const id = (what: string) =>
  z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a UUID.").describe(`The ${what} id (a UUID from another tool's result).`);
const confirm = z
  .boolean()
  .optional()
  .describe("Must be true to actually do this. Call once without it to get a preview, show it to the person, and only confirm after they agree.");

const REPORT_TABLES = ["funnel", "jobs", "trend", "stages", "sources", "reasons", "interviewers", "apply"] as const;

/** Rows as objects keyed by the table's column names, which is easier for a model to read. */
function tableRows(report: { head: string[]; rows: unknown[][] }) {
  return report.rows.map((row) => Object.fromEntries(report.head.map((h, i) => [h, row[i]])));
}

function slimCandidate(c: any) {
  return {
    id: c.id,
    full_name: c.full_name,
    email: c.email,
    location: c.location,
    source: c.source,
    tags: c.tags,
    added: c.created_at,
  };
}

async function optional<T>(load: () => Promise<T>, label: string): Promise<T | string> {
  try {
    return await load();
  } catch (err: any) {
    if (err?.status === 403) return `Not available: ${label} needs a scope this key doesn't have.`;
    throw err;
  }
}

export const TOOLS: ToolDef[] = [
  {
    name: "whoami",
    title: "Who am I",
    kind: "read",
    description: "Show the PennyATS user this connection acts as, their role, and the key's scopes. Call this first if a tool says something is missing or forbidden.",
    input: {},
    run: async (client) => client.get("/me"),
  },
  {
    name: "search_candidates",
    title: "Search candidates",
    kind: "read",
    description:
      'Search candidates, newest first. `query` supports AND, OR, NOT, and "quoted phrases" across profile, tags, resume text, notes, and history. Combine with filters. Returns up to `limit` results and a `next_cursor` for more.',
    input: {
      query: z.string().max(200).optional().describe('Boolean search, e.g. "rust OR go" NOT intern'),
      job_id: id("job").optional(),
      stage: z.string().max(200).optional().describe("Stage name, e.g. Onsite. Case-insensitive, across jobs."),
      status: z.enum(["active", "hired", "rejected", "withdrawn"]).optional(),
      tag: z.string().max(60).optional(),
      added_since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
      limit: z.number().int().min(1).max(100).default(20),
      cursor: z.string().optional().describe("next_cursor from a previous call"),
    },
    run: async (client, a) => {
      const page = await client.get("/candidates", {
        q: a.query,
        job_id: a.job_id,
        stage: a.stage,
        status: a.status,
        tag: a.tag,
        created_from: a.added_since,
        limit: a.limit ?? 20,
        cursor: a.cursor,
      });
      return { candidates: page.data.map(slimCandidate), next_cursor: page.next_cursor };
    },
  },
  {
    name: "get_candidate",
    title: "View a candidate",
    kind: "read",
    description: "A candidate's profile, every application you can see (job, stage, status, rejection reason), tags, and their most recent notes.",
    input: { candidate_id: id("candidate") },
    run: async (client, a) => {
      const candidate = await client.get(`/candidates/${seg(a.candidate_id)}`);
      const notes = await optional(() => client.get(`/candidates/${seg(a.candidate_id)}/notes`, { limit: 10 }).then((p) => p.data), "notes");
      return { ...candidate, recent_notes: notes };
    },
  },
  {
    name: "list_jobs",
    title: "List jobs",
    kind: "read",
    description: "Jobs you can see, with their pipeline stages in order (ids and names). Use stage ids with move_candidate_stage.",
    input: { status: z.enum(["draft", "open", "closed"]).optional().describe("Defaults to all statuses.") },
    run: async (client, a) => {
      const jobs: any[] = [];
      let cursor: string | null = null;
      do {
        const page: any = await client.get("/jobs", { status: a.status, limit: 100, cursor });
        jobs.push(...page.data);
        cursor = page.next_cursor;
      } while (cursor && jobs.length < 500);
      return jobs.map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        department: j.department,
        location: j.location,
        stages: j.stages.map((s: any) => ({ id: s.id, name: s.name })),
      }));
    },
  },
  {
    name: "list_applications",
    title: "List applications",
    kind: "read",
    description: "Applications, newest first, filtered by job, stage, status, or candidate. Use it to find who is in a stage or who applied recently.",
    input: {
      job_id: id("job").optional(),
      stage_id: id("stage").optional(),
      candidate_id: id("candidate").optional(),
      status: z.enum(["active", "hired", "rejected", "withdrawn"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(),
    },
    run: async (client, a) => {
      const page = await client.get("/applications", {
        job_id: a.job_id,
        stage_id: a.stage_id,
        candidate_id: a.candidate_id,
        status: a.status,
        limit: a.limit ?? 50,
        cursor: a.cursor,
      });
      return { applications: page.data, next_cursor: page.next_cursor };
    },
  },
  {
    name: "get_scorecards",
    title: "Read scorecards",
    kind: "read",
    description:
      "Interview scorecards on one application: recommendation, 1 to 4 ratings, and summary. Interviewer connections only see others' scorecards after submitting their own; hidden_count says how many are hidden.",
    input: { application_id: id("application") },
    run: async (client, a) => client.get(`/applications/${seg(a.application_id)}/scorecards`),
  },
  {
    name: "run_report",
    title: "Run a report",
    kind: "read",
    description:
      "Hiring reports, the same as the Reports page. funnel: how many reached each stage. jobs: per-job applicants, active, hires, days to hire. trend: applications and hires by month. stages: average and median days in each stage. sources: applicants, advanced, and hires by source. reasons: rejection reasons. interviewers: scorecards submitted per interviewer. apply: careers page views, apply starts, and submits.",
    input: {
      report: z.enum(REPORT_TABLES),
      job_id: id("job").optional().describe("Limit to one job. Some reports (funnel, stages) need one."),
      period: z.enum(["30", "90", "365", "all"]).default("90").describe("Days back, or all"),
    },
    run: async (client, a) => {
      const report = await client.get(`/reports/${seg(a.report)}`, { job_id: a.job_id, period: a.period ?? "90" });
      return { report: report.table, period: a.period ?? "90", rows: tableRows(report) };
    },
  },
  {
    name: "list_email_templates",
    title: "List email templates",
    kind: "read",
    description: "Email templates you can draft from, with ids and subjects.",
    input: {},
    run: async (client) => (await client.get("/email-templates")).data,
  },
  {
    name: "draft_email",
    title: "Draft an email from a template",
    kind: "read",
    description: "Fill a template with one application's details (name, job, stage, company). Nothing is sent or saved. Show the draft to the person; sending is send_email.",
    input: { application_id: id("application"), template_id: id("template") },
    run: async (client, a) => {
      const draft = await client.post(`/applications/${seg(a.application_id)}/email-drafts`, { template_id: a.template_id });
      return { to: draft.to, subject: draft.subject, body: draft.text };
    },
  },

  /* ---------- Writes (read-write mode only) ---------- */

  {
    name: "move_candidate_stage",
    title: "Move a candidate to another stage",
    kind: "write",
    description:
      "Move an active application to another stage of its job, like dragging the card on the pipeline board. This logs stage history, creates that stage's planned interviews, sends the stage's automatic email if one is set up, and notifies the hiring team. Give stage_id or stage_name.",
    input: {
      application_id: id("application"),
      stage_id: id("stage").optional(),
      stage_name: z.string().max(100).optional().describe("Stage name on the application's job, e.g. Onsite"),
    },
    run: async (client, a) => {
      let stageId: string | undefined = a.stage_id;
      if (!stageId) {
        if (!a.stage_name) throw new Error("Give stage_id or stage_name.");
        const app = await client.get(`/applications/${seg(a.application_id)}`);
        const stages = (await client.get(`/jobs/${seg(app.job_id)}/stages`)).data as { id: string; name: string }[];
        const match = stages.find((s) => s.name.toLowerCase() === String(a.stage_name).trim().toLowerCase());
        if (!match) throw new Error(`No stage named "${a.stage_name}" on this job. Stages: ${stages.map((s) => s.name).join(", ")}.`);
        stageId = match.id;
      }
      const moved = await client.post(`/applications/${seg(a.application_id)}/move`, { stage_id: stageId });
      return { moved: true, application: moved };
    },
  },
  {
    name: "add_note",
    title: "Add a note to a candidate",
    kind: "write",
    description: "Add a note to a candidate's profile, written as the connected user. Notes are visible to everyone who can see the candidate.",
    input: { candidate_id: id("candidate"), body: z.string().min(1).max(10_000) },
    run: async (client, a) => client.post(`/candidates/${seg(a.candidate_id)}/notes`, { body: a.body }),
  },

  /* ---------- Destructive (read-write mode and confirm: true) ---------- */

  {
    name: "reject_application",
    title: "Reject an application",
    kind: "destructive",
    description:
      "Reject an application with a standard reason (call without confirm to see the allowed reasons in the preview). The candidate leaves the active pipeline. It can be reopened later in the app.",
    input: {
      application_id: id("application"),
      reason: z.string().max(200).describe('A standard reason, e.g. "Not enough relevant experience"'),
      note: z.string().max(400).optional(),
      confirm,
    },
    preview: async (client, a) => {
      const app = await client.get(`/applications/${seg(a.application_id)}`);
      const candidate = await optional(() => client.get(`/candidates/${seg(app.candidate_id)}`), "the candidate's name");
      return {
        would: "reject this application",
        candidate: typeof candidate === "string" ? app.candidate_id : candidate.full_name,
        job: app.job_title,
        current_stage: app.stage_name,
        current_status: app.status,
        reason: a.reason,
        note: a.note ?? null,
      };
    },
    run: async (client, a) => {
      const app = await client.post(`/applications/${seg(a.application_id)}/status`, { status: "rejected", reason: a.reason, note: a.note });
      return { rejected: true, application: app };
    },
  },
  {
    name: "send_email",
    title: "Send a template email",
    kind: "destructive",
    description: "Send a template email to the candidate on an application. It goes to a real person and can't be unsent. Needs SMTP on the PennyATS server. Recorded on the candidate's timeline.",
    input: { application_id: id("application"), template_id: id("template"), confirm },
    preview: async (client, a) => {
      const draft = await client.post(`/applications/${seg(a.application_id)}/email-drafts`, { template_id: a.template_id });
      return { would: "send this email now", to: draft.to, subject: draft.subject, body: draft.text };
    },
    run: async (client, a) => client.post(`/applications/${seg(a.application_id)}/emails`, { template_id: a.template_id }),
  },
  {
    name: "delete_candidate",
    title: "Permanently delete a candidate",
    kind: "destructive",
    description:
      "Permanently delete a candidate and everything about them (applications, scorecards, notes, emails, resume), for example for a deletion request. Cannot be undone. Needs an admin key with candidates:delete.",
    input: { candidate_id: id("candidate"), confirm },
    preview: async (client, a) => {
      const c = await client.get(`/candidates/${seg(a.candidate_id)}`);
      return {
        would: "permanently delete this candidate. This cannot be undone.",
        candidate: c.full_name,
        applications: c.applications.map((x: any) => `${x.job_title} (${x.status})`),
      };
    },
    run: async (client, a) => client.delete(`/candidates/${seg(a.candidate_id)}`),
  },
];

/** The tools available in a mode. */
export function toolsFor(mode: { readOnly: boolean }): ToolDef[] {
  return mode.readOnly ? TOOLS.filter((t) => t.kind === "read") : TOOLS;
}

/**
 * Plain JSON tool definitions (name, description, JSON Schema input) for agents that don't
 * speak MCP, e.g. OpenAI function calling. Run them by calling the same API endpoints.
 */
export function toolDefinitions(mode: { readOnly: boolean } = { readOnly: false }) {
  return toolsFor(mode).map((t) => ({
    name: t.name,
    description: t.description,
    kind: t.kind,
    input_schema: z.toJSONSchema(z.object(t.input), { io: "input" }),
  }));
}
