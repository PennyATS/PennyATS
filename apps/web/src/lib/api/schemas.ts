/**
 * Request and response schemas for the public API. The route table (routes.ts) points at
 * these, the handlers validate with them, and `pnpm api:spec` turns them into the OpenAPI
 * document, so the docs and the code can't drift apart. No Next.js or database imports.
 */
import { z } from "zod";
import { EMPLOYMENT_TYPES, WORKPLACE_TYPES } from "../job-fields";
import { REJECTION_REASONS } from "../candidate-review";
import { REPORT_TABLES } from "../reports";
import { RECOMMENDATIONS } from "../scorecards";
import { WEBHOOK_EVENT_NAMES } from "../webhook-events";

/** Named schemas become `#/components/schemas/<id>` in the OpenAPI document. */
export const registry = z.registry<{ id: string; description?: string }>();
function named<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  registry.add(schema, { id, description });
  return schema;
}

// Any 8-4-4-4-12 hex id. Postgres uuids from older seeds aren't always RFC 4122 variants.
export const Id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Must be a UUID.")
  .meta({ format: "uuid" });
const Timestamp = z.string().meta({ format: "date-time", description: "ISO 8601 timestamp in UTC." });
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/* ---------- Shared ---------- */

export const ErrorBody = named(
  "Error",
  z.object({
    error: z.object({
      code: z.enum([
        "invalid_request",
        "unauthorized",
        "missing_scope",
        "forbidden",
        "not_found",
        "conflict",
        "unprocessable",
        "rate_limited",
        "internal",
      ]),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
  "Every error response has this shape. `code` is stable; `message` is for people.",
);

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25).describe("Page size, 1 to 100."),
  cursor: z.string().max(500).optional().describe("The `next_cursor` from the previous page."),
});

function page<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    next_cursor: z.string().nullable().describe("Pass as `cursor` to get the next page. Null on the last page."),
  });
}

export const IdParams = z.object({ id: Id });

/* ---------- Jobs and stages ---------- */

export const Stage = named(
  "Stage",
  z.object({ id: Id, job_id: Id, name: z.string(), position: z.number().int() }),
  "A pipeline stage. Applications move through a job's stages in `position` order.",
);

export const Job = named(
  "Job",
  z.object({
    id: Id,
    slug: z.string(),
    title: z.string(),
    status: z.enum(["draft", "open", "closed"]),
    department: z.string().nullable(),
    team: z.string().nullable(),
    location: z.string().nullable(),
    region: z.string().nullable(),
    headcount: z.number().int().nullable(),
    employment_type: z.string().nullable(),
    workplace_type: z.string().nullable(),
    description: z.string().nullable(),
    confidential: z.boolean(),
    hiring_manager_id: Id.nullable(),
    recruiter_id: Id.nullable(),
    stages: z.array(Stage),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
  "A job. Compensation and internal notes are not exposed through the API yet.",
);

const JobFields = {
  title: text(200),
  status: z.enum(["draft", "open", "closed"]),
  department: optionalText(200),
  team: optionalText(200),
  location: optionalText(200),
  region: optionalText(200),
  headcount: z.number().int().min(0).max(10_000).nullable().optional(),
  description: optionalText(20_000),
  employment_type: z.enum(Object.keys(EMPLOYMENT_TYPES) as [keyof typeof EMPLOYMENT_TYPES]).nullable().optional(),
  workplace_type: z.enum(Object.keys(WORKPLACE_TYPES) as [keyof typeof WORKPLACE_TYPES]).nullable().optional(),
  hiring_manager_id: Id.nullable().optional(),
  recruiter_id: Id.nullable().optional(),
};

export const CreateJob = named(
  "CreateJob",
  z.strictObject({ ...JobFields, status: JobFields.status.default("draft") }),
  "New jobs get the default pipeline stages.",
);
export const UpdateJob = named("UpdateJob", z.strictObject(JobFields).partial(), "Only the fields you send change.");
export const JobsQuery = PageQuery.extend({ status: z.enum(["draft", "open", "closed"]).optional() });
export const JobPage = page(Job);
export const StageList = z.object({ data: z.array(Stage) });
export const CreateStage = z.strictObject({ name: text(100) });

/* ---------- Candidates, tags, notes ---------- */

export const ApplicationStatus = z.enum(["active", "hired", "rejected", "withdrawn"]);

export const Application = named(
  "Application",
  z.object({
    id: Id,
    candidate_id: Id,
    job_id: Id,
    job_title: z.string(),
    stage_id: Id.nullable(),
    stage_name: z.string().nullable(),
    status: ApplicationStatus,
    rejection_reason: z.string().nullable(),
    applied_at: Timestamp,
    stage_changed_at: Timestamp,
  }),
  "One candidate's application to one job.",
);

export const Candidate = named(
  "Candidate",
  z.object({
    id: Id,
    full_name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    linkedin_url: z.string().nullable(),
    location: z.string().nullable(),
    source: z.string().nullable(),
    tags: z.array(z.string()),
    has_resume: z.boolean(),
    consented_at: Timestamp.nullable(),
    created_at: Timestamp,
  }),
  "A person. Emails are stored lowercased and are unique.",
);

export const CandidateDetail = named(
  "CandidateDetail",
  Candidate.extend({ applications: z.array(Application).describe("Only applications on jobs the key's user can see.") }),
);

export const CandidatesQuery = PageQuery.extend({
  q: z.string().max(200).optional().describe("Boolean search over profile, tags, resume, notes, and history, as in the app (AND, OR, NOT, quotes)."),
  name: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  source: z.string().max(200).optional(),
  job_id: Id.optional(),
  stage: z.string().max(200).optional().describe("Stage name, case-insensitive, across jobs."),
  status: ApplicationStatus.optional(),
  tag: z.string().max(200).optional(),
  created_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, inclusive."),
  created_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, inclusive."),
});
export const CandidatePage = page(Candidate);

export const CreateCandidate = named(
  "CreateCandidate",
  z.strictObject({
    job_id: Id.describe("The job to apply them to. They start in its first stage."),
    full_name: text(200),
    email: z.string().trim().max(254).nullable().optional().describe("Reuses the existing candidate when the email is already known."),
    phone: optionalText(50),
    linkedin_url: optionalText(500),
    location: optionalText(200),
    source: optionalText(100).describe("Defaults to API."),
    tags: z.array(z.string().max(40)).max(30).optional(),
  }),
);
export const CreatedCandidate = z.object({
  candidate: CandidateDetail,
  application_id: Id,
  created: z.boolean().describe("False when the email matched an existing candidate."),
});

export const TagList = z.object({ data: z.array(z.string()) });
export const AddTags = z.strictObject({ tags: z.array(z.string().max(60)).min(1).max(30) });
export const TagParams = z.object({ id: Id, tag: z.string().min(1).max(60) });

export const Note = named(
  "Note",
  z.object({ id: Id, candidate_id: Id, author_id: Id, author_name: z.string(), body: z.string(), created_at: Timestamp }),
);
export const NotePage = page(Note);
export const CreateNote = z.strictObject({ body: text(10_000) });

/* ---------- Applications ---------- */

export const ApplicationsQuery = PageQuery.extend({
  job_id: Id.optional(),
  candidate_id: Id.optional(),
  stage_id: Id.optional(),
  status: ApplicationStatus.optional(),
});
export const ApplicationPage = page(Application);
export const CreateApplication = z.strictObject({ candidate_id: Id, job_id: Id });
export const MoveApplication = z.strictObject({ stage_id: Id.describe("A stage of the application's job.") });
export const SetStatus = named(
  "SetStatus",
  z.strictObject({
    status: ApplicationStatus.describe("`active` reopens a closed application."),
    reason: z
      .string()
      .max(500)
      .optional()
      .describe(`Required to reject: one of ${REJECTION_REASONS.map((r) => `"${r}"`).join(", ")}. Free text for withdrawn.`),
    note: z.string().max(400).optional().describe("Optional note stored with a rejection reason."),
  }),
);

/* ---------- Scorecards and interviews ---------- */

export const Scorecard = named(
  "Scorecard",
  z.object({
    id: Id,
    application_id: Id,
    interview_id: Id.nullable(),
    author_id: Id,
    author_name: z.string(),
    stage_name: z.string(),
    recommendation: z.enum(RECOMMENDATIONS),
    ratings: z.record(z.string(), z.number().int().min(1).max(4)),
    summary: z.string().nullable(),
    created_at: Timestamp,
    updated_at: Timestamp,
  }),
);
export const ScorecardList = z.object({
  data: z.array(Scorecard),
  hidden_count: z
    .number()
    .int()
    .describe("Other people's scorecards hidden until the key's user submits their own, as in the app."),
});
export const SubmitScorecard = named(
  "SubmitScorecard",
  z.strictObject({
    interview_id: Id.nullable().optional().describe("Omit for a stage-level scorecard on the current stage."),
    recommendation: z.enum(RECOMMENDATIONS),
    ratings: z
      .record(z.string(), z.number().int().min(1).max(4))
      .default({})
      .describe("Attribute name to rating, 1 to 4. Names must be the interview's or job's scorecard attributes."),
    summary: z.string().max(10_000).nullable().optional(),
  }),
  "Submitting again for the same interview (or stage) edits the earlier scorecard.",
);

export const Interview = named(
  "Interview",
  z.object({
    id: Id,
    application_id: Id,
    name: z.string(),
    stage_name: z.string(),
    duration_minutes: z.number().int(),
    status: z.enum(["cancelled", "to_schedule", "scheduled", "feedback_due", "complete"]),
    scheduled_at: Timestamp.nullable(),
    meeting_location: z.string().nullable(),
    interviewer_ids: z.array(Id),
    completed_at: Timestamp.nullable(),
    cancelled_at: Timestamp.nullable(),
    created_at: Timestamp,
  }),
  "Status is derived from the schedule and submitted scorecards.",
);
export const InterviewList = z.object({ data: z.array(Interview) });
export const CreateInterview = z.strictObject({
  name: text(120),
  duration_minutes: z.number().int().min(5).max(480).default(45),
  interviewer_ids: z.array(Id).max(20).default([]).describe("Active users. They join the job's hiring team."),
});

/* ---------- Reports, templates, email ---------- */

export const ReportParams = z.object({ table: z.enum(REPORT_TABLES) });
export const ReportQuery = z.object({
  job_id: Id.optional().describe("Limit to one job. Omit for all jobs."),
  period: z.enum(["30", "90", "365", "all"]).default("90").describe("Days back, or all time."),
});
export const Report = named(
  "Report",
  z.object({
    table: z.enum(REPORT_TABLES),
    head: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  }),
  "The same table the Reports page and its CSV download show.",
);

export const EmailTemplate = named(
  "EmailTemplate",
  z.object({ id: Id, name: z.string(), subject: z.string(), folder_id: Id.nullable(), updated_at: Timestamp }),
);
export const EmailTemplateList = z.object({ data: z.array(EmailTemplate) });
export const TemplateRef = z.strictObject({ template_id: Id });
export const EmailDraft = named(
  "EmailDraft",
  z.object({
    application_id: Id,
    template_id: Id,
    to: z.string().nullable(),
    subject: z.string(),
    text: z.string(),
    html: z.string(),
  }),
  "A rendered template. Nothing is sent or recorded.",
);
export const EmailResult = named(
  "EmailResult",
  z.object({
    id: Id,
    status: z.enum(["sent", "failed", "skipped"]),
    error: z.string().nullable(),
  }),
  "Every attempt is recorded on the candidate's timeline, including failed and skipped ones.",
);

/* ---------- Me ---------- */

export const Me = named(
  "Me",
  z.object({
    key: z.object({ id: Id, name: z.string(), prefix: z.string(), scopes: z.array(z.string()), expires_at: Timestamp.nullable() }),
    user: z.object({ id: Id, name: z.string(), email: z.string(), role: z.enum(["admin", "recruiter", "interviewer"]) }),
    webhook_events: z.array(z.enum(WEBHOOK_EVENT_NAMES)),
  }),
  "The key making the request and the user it acts as.",
);

export const Deleted = z.object({ deleted: z.literal(true) });
