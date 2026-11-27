/**
 * The PennyATS open data format, version 1. These zod schemas are the source of truth: the JSON
 * Schema files in docs/schema/ are generated from them, export builds documents that pass them,
 * and import validates with them. See docs/schema/README.md for the compatibility policy.
 *
 * Conventions: snake_case fields; ids are UUIDs kept across export and import; people are
 * referenced by email so a document can move between instances; times are ISO 8601 UTC.
 */
import { z } from "zod";

/** Bump per the compatibility policy, and add a CHANGELOG entry. */
export const SCHEMA_VERSION = "1.1.0";
export const SCHEMA_ID_BASE = "https://github.com/PennyATS/PennyATS/blob/main/docs/schema/v1";

export const registry = z.registry<{ id: string; title: string; description: string }>();

const Id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .meta({ format: "uuid" });
const Email = z.string().min(3).max(254).meta({ description: "A person's email address, lowercase. Listed in `people`." });
const Time = z.string().meta({ format: "date-time" });
const nullable = <T extends z.ZodType>(t: T) => t.nullable();

export const Person = z.object({
  email: Email,
  name: z.string(),
  role: z.enum(["admin", "recruiter", "interviewer"]).meta({
    description: "Closest 1.0 role with no more access than `role_key`, for readers that only know the original three.",
  }),
  role_key: z
    .string()
    .max(64)
    .optional()
    .meta({
      description:
        "The person's role preset (1.1.0), for example `head_of_talent`, `coordinator`, `hiring_manager`, or `executive`. Open: readers must accept unknown values and fall back to `role`.",
    }),
});

export const Stage = z.object({
  id: Id,
  name: z.string(),
  position: z.number().int().meta({ description: "Order in the pipeline, starting at 0." }),
});

export const Job = z.object({
  id: Id,
  slug: z.string().meta({ description: "URL name on the careers page. Unique." }),
  title: z.string(),
  status: z.enum(["draft", "open", "closed"]),
  department: nullable(z.string()),
  team: nullable(z.string()),
  location: nullable(z.string()),
  region: nullable(z.string()),
  headcount: nullable(z.number().int()),
  description: nullable(z.string()),
  employment_type: nullable(z.string()).meta({ description: "full_time, part_time, contract, internship, or temporary." }),
  workplace_type: nullable(z.string()).meta({ description: "onsite, hybrid, or remote." }),
  requisition_id: nullable(z.string()),
  compensation: z.object({
    currency: nullable(z.string()),
    period: nullable(z.string()).meta({ description: "year or hour." }),
    min: nullable(z.number().int()),
    mid: nullable(z.number().int()),
    max: nullable(z.number().int()),
    public: z.boolean().meta({ description: "Shown on the careers page." }),
  }),
  equity_note: nullable(z.string()),
  target_start_date: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  priority: nullable(z.string()),
  confidential: z.boolean().meta({ description: "Hidden from the public careers page." }),
  internal_notes: nullable(z.string()),
  scorecard_attributes: z.array(z.string()),
  hiring_manager_email: nullable(Email),
  recruiter_email: nullable(Email),
  hiring_team_emails: z.array(Email),
  created_by_email: nullable(Email),
  stages: z.array(Stage),
  created_at: Time,
  updated_at: Time,
});

export const Candidate = z.object({
  id: Id,
  full_name: z.string(),
  email: nullable(z.string()).meta({ description: "Lowercase. Unique when present." }),
  phone: nullable(z.string()),
  linkedin_url: nullable(z.string()),
  location: nullable(z.string()),
  source: nullable(z.string()),
  tags: z.array(z.string()),
  resume_name: nullable(z.string()).meta({ description: "Original file name. The file itself is not in the export." }),
  resume_text: nullable(z.string()),
  consented_at: nullable(Time).meta({ description: "When they agreed to the privacy notice, if one was required." }),
  created_at: Time,
});

export const ApplicationEvent = z.object({
  type: z.string().meta({
    description:
      "applied, added, stage_changed, rejected, withdrawn, hired, reopened, scorecard_submitted, interview_added, interview_scheduled, interview_completed, interview_cancelled. Readers must accept types they don't know.",
  }),
  at: Time,
  actor_email: nullable(Email).meta({ description: "Null for the candidate's own actions and automated changes." }),
  data: z.record(z.string(), z.unknown()).meta({ description: "For stage_changed: `from` and `to` stage ids. Stage history in reports is rebuilt from these events." }),
});

export const ApplicationNote = z.object({
  kind: z.string().meta({ description: "phone_screen." }),
  body: z.string(),
  author_email: nullable(Email),
  created_at: Time,
  updated_at: Time,
});

export const Application = z.object({
  id: Id,
  candidate_id: Id,
  job_id: Id,
  stage_id: nullable(Id),
  status: z.enum(["active", "hired", "rejected", "withdrawn"]),
  rejection_reason: nullable(z.string()),
  applied_at: Time,
  stage_changed_at: Time,
  events: z.array(ApplicationEvent).meta({ description: "Oldest first." }),
  notes: z.array(ApplicationNote),
});

export const Interview = z.object({
  id: Id,
  application_id: Id,
  stage_id: nullable(Id),
  name: z.string(),
  stage_name: z.string(),
  duration_minutes: z.number().int(),
  attributes: z.array(z.string()),
  instructions: nullable(z.string()),
  scheduled_at: nullable(Time),
  scheduled_time_zone: nullable(z.string()),
  meeting_location: nullable(z.string()),
  interviewer_emails: z.array(Email),
  completed_at: nullable(Time),
  cancelled_at: nullable(Time),
  created_at: Time,
});

export const Scorecard = z.object({
  id: Id,
  application_id: Id,
  interview_id: nullable(Id),
  author_email: Email,
  stage_name: z.string(),
  recommendation: z.enum(["strong_no", "no", "yes", "strong_yes"]),
  ratings: z.record(z.string(), z.number().int().min(1).max(4)).meta({ description: "Attribute name to rating, 1 to 4." }),
  summary: nullable(z.string()),
  created_at: Time,
  updated_at: Time,
});

export const Note = z.object({
  id: Id,
  candidate_id: Id,
  author_email: Email,
  body: z.string(),
  created_at: Time,
});

export const ExportDocument = z.object({
  format: z.literal("pennyats-export"),
  schema_version: z.string().regex(/^1\.\d+\.\d+$/).meta({ description: "Semver. Readers accept any 1.x document." }),
  exported_at: Time,
  people: z.array(Person).meta({ description: "Everyone referenced by email elsewhere in the document. No passwords." }),
  jobs: z.array(Job),
  candidates: z.array(Candidate),
  applications: z.array(Application),
  interviews: z.array(Interview),
  scorecards: z.array(Scorecard),
  notes: z.array(Note),
});

export type ExportDocument = z.infer<typeof ExportDocument>;

/** The entities published as their own JSON Schema files, in this order. */
export const ENTITIES = [
  { id: "Person", file: "person", schema: Person, title: "Person", description: "A teammate referenced by the data: author, interviewer, hiring team member." },
  { id: "Job", file: "job", schema: Job, title: "Job", description: "A job with its pipeline stages and hiring team." },
  { id: "Stage", file: "stage", schema: Stage, title: "Stage", description: "A pipeline stage of a job." },
  { id: "Candidate", file: "candidate", schema: Candidate, title: "Candidate", description: "A person who applied or was added." },
  { id: "Application", file: "application", schema: Application, title: "Application", description: "One candidate's application to one job, with its history." },
  { id: "Interview", file: "interview", schema: Interview, title: "Interview", description: "One interview for one application." },
  { id: "Scorecard", file: "scorecard", schema: Scorecard, title: "Scorecard", description: "One interviewer's feedback on an application or interview." },
  { id: "Note", file: "note", schema: Note, title: "Note", description: "A note on a candidate's profile." },
  { id: "ExportDocument", file: "export", schema: ExportDocument, title: "PennyATS export", description: "A whole workspace export: everything above in one document." },
] as const;

for (const e of ENTITIES) registry.add(e.schema, { id: e.id, title: e.title, description: e.description });
