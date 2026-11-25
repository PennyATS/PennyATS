import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ---------- Enums ---------- */

export const userRole = pgEnum("user_role", ["admin", "recruiter", "interviewer"]);
export const jobStatus = pgEnum("job_status", ["draft", "open", "closed"]);
export const applicationStatus = pgEnum("application_status", [
  "active",
  "hired",
  "rejected",
  "withdrawn",
]);
export const recommendation = pgEnum("recommendation", [
  "strong_no",
  "no",
  "yes",
  "strong_yes",
]);

/* ---------- Users and workspace ---------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    role: userRole("role").notNull().default("recruiter"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/** Login sessions. `id` is the SHA-256 of the cookie token, so a leaked table can't be replayed. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Pending user invites. The link carries the token; only its SHA-256 is stored. */
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  role: userRole("role").notNull().default("recruiter"),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-time password reset links. Only the SHA-256 of each link token is stored. */
export const passwordResets = pgTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

/** Single-row-per-key workspace settings (branding, AI config, etc). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Jobs and pipeline ---------- */

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    department: text("department"),
    location: text("location"),
    description: text("description"),
    status: jobStatus("status").notNull().default("draft"),
    /** What interviewers rate on this job's scorecards, 1 to 4 each. */
    scorecardAttributes: text("scorecard_attributes")
      .array()
      .notNull()
      .default(["Role skills", "Problem solving", "Communication", "Ownership"]),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jobs_slug_idx").on(t.slug), index("jobs_status_idx").on(t.status)],
);

/** Per-job pipeline stages, ordered by position. */
export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("stages_job_idx").on(t.jobId, t.position)],
);

export const jobTeam = pgTable(
  "job_team",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.userId] })],
);

/* ---------- Candidates and applications ---------- */

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    location: text("location"),
    source: text("source"),
    tags: text("tags").array().notNull().default([]),
    /** Storage key for an uploaded resume (see apps/web/src/lib/storage.ts). */
    resumeKey: text("resume_key"),
    /** Original file name, shown in the UI and used on download. */
    resumeName: text("resume_name"),
    /** When the candidate agreed to the privacy notice on the apply form, if one was required. */
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    resumeText: text("resume_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Emails are stored lowercased; one candidate per email. Candidates without an email are allowed.
  (t) => [uniqueIndex("candidates_email_idx").on(t.email)],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").references(() => stages.id),
    status: applicationStatus("status").notNull().default("active"),
    rejectionReason: text("rejection_reason"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("applications_candidate_job_idx").on(t.candidateId, t.jobId),
    index("applications_job_stage_idx").on(t.jobId, t.stageId),
  ],
);

/* ---------- Interview loop ---------- */

/** The interview plan: interviews a job runs in each stage. */
export const interviewTemplates = pgTable(
  "interview_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(45),
    /** Scorecard attributes this interview covers. Empty means all of the job's attributes. */
    attributes: text("attributes").array().notNull().default([]),
    /** Shown to interviewers on the scorecard form. */
    instructions: text("instructions"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("interview_templates_stage_idx").on(t.stageId, t.position)],
);

/** Default interviewers for a planned interview. */
export const interviewTemplateInterviewers = pgTable(
  "interview_template_interviewers",
  {
    templateId: uuid("template_id")
      .notNull()
      .references(() => interviewTemplates.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.userId] })],
);

/**
 * One interview for one candidate's application, created from the plan when they enter a
 * stage, or added by hand. Name, stage and attributes are copied, so editing or deleting
 * the plan later doesn't rewrite a candidate's history. Status is derived (see
 * apps/web/src/lib/interviews.ts) from the timestamps and submitted scorecards.
 */
export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => interviewTemplates.id, { onDelete: "set null" }),
    stageId: uuid("stage_id").references(() => stages.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    stageName: text("stage_name").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(45),
    attributes: text("attributes").array().notNull().default([]),
    instructions: text("instructions"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("interviews_application_idx").on(t.applicationId),
    // A planned interview is created once per application. Ad hoc ones (no template) can repeat.
    uniqueIndex("interviews_application_template_idx").on(t.applicationId, t.templateId),
  ],
);

/** Who runs an interview for a candidate. */
export const interviewInterviewers = pgTable(
  "interview_interviewers",
  {
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.interviewId, t.userId] }), index("interview_interviewers_user_idx").on(t.userId)],
);

/* ---------- Feedback, notes, email ---------- */

export const scorecards = pgTable(
  "scorecards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    /** Stage name at the time of the interview, kept as text so renaming a stage doesn't rewrite history. */
    stageName: text("stage_name").notNull(),
    /** The interview this feedback is for, when it came from the interview loop. */
    interviewId: uuid("interview_id").references(() => interviews.id, { onDelete: "set null" }),
    /** Attribute ratings from 1 to 4, e.g. { "Problem solving": 4 } */
    ratings: jsonb("ratings").$type<Record<string, number>>().notNull().default({}),
    recommendation: recommendation("recommendation").notNull(),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One scorecard per interviewer per stage; submitting again edits it.
  (t) => [
    // One scorecard per interviewer per interview; resubmitting edits it.
    uniqueIndex("scorecards_author_interview_idx")
      .on(t.interviewId, t.authorId)
      .where(sql`${t.interviewId} is not null`),
    // Scorecards not tied to an interview: one per interviewer per stage, as before.
    uniqueIndex("scorecards_author_stage_idx")
      .on(t.applicationId, t.authorId, t.stageName)
      .where(sql`${t.interviewId} is null`),
    index("scorecards_application_idx").on(t.applicationId),
  ],
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notes_candidate_idx").on(t.candidateId)],
);

export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  direction: text("direction").notNull().default("outbound"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sentBy: uuid("sent_by").references(() => users.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Audit trail of stage moves and status changes. */
export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_application_idx").on(t.applicationId)],
);

/**
 * Record of privacy-sensitive actions (deletions, exports, retention purges), kept so
 * you can show a request was handled. Never store the deleted person's details here.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    /** Null for automated runs such as a scheduled retention purge. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

/** Tracks whether the instance has been set up (first admin created). */
export const instance = pgTable(
  "instance",
  {
    id: boolean("id").primaryKey().default(true),
    setupComplete: boolean("setup_complete").notNull().default(false),
  },
  // Single-row table: the only allowed id is true.
  () => [check("instance_singleton", sql`"id" = true`)],
);
