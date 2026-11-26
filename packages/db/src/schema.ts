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
  date,
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

/** An interviewer's Google Calendar OAuth grant. Refresh tokens are encrypted by the app. */
export const googleCalendarConnections = pgTable("google_calendar_connections", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  workingTimeZone: text("working_time_zone").notNull().default("UTC"),
  workingDays: integer("working_days").array().notNull().default([1, 2, 3, 4, 5]),
  workStartMinute: integer("work_start_minute").notNull().default(540),
  workEndMinute: integer("work_end_minute").notNull().default(1020),
});

/* ---------- Jobs and pipeline ---------- */

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    department: text("department"),
    team: text("team"),
    location: text("location"),
    region: text("region"),
    headcount: integer("headcount"),
    description: text("description"),
    status: jobStatus("status").notNull().default("draft"),
    /* Optional details; nothing here is required. See apps/web/src/lib/job-fields.ts. */
    employmentType: text("employment_type"),
    workplaceType: text("workplace_type"),
    requisitionId: text("requisition_id"),
    compCurrency: text("comp_currency"),
    /** "year" or "hour". */
    compPeriod: text("comp_period"),
    compMin: integer("comp_min"),
    compMid: integer("comp_mid"),
    compMax: integer("comp_max"),
    /** Show the range on the careers page. */
    compPublic: boolean("comp_public").notNull().default(false),
    equityNote: text("equity_note"),
    hiringManagerId: uuid("hiring_manager_id").references(() => users.id, { onDelete: "set null" }),
    recruiterId: uuid("recruiter_id").references(() => users.id, { onDelete: "set null" }),
    targetStartDate: date("target_start_date", { mode: "string" }),
    priority: text("priority"),
    /** Hidden from the public careers page even while open. */
    confidential: boolean("confidential").notNull().default(false),
    internalNotes: text("internal_notes"),
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

/** Optional per-stage scheduling automation, off until a team opts in. */
export const stageSchedulingSettings = pgTable("stage_scheduling_settings", {
  stageId: uuid("stage_id").primaryKey().references(() => stages.id, { onDelete: "cascade" }),
  autoLinkMode: text("auto_link_mode").notNull().default("none"),
  reminderMinutes: integer("reminder_minutes"),
  /** Template emailed to the candidate when an application enters this stage. Null means off. */
  emailTemplateId: uuid("email_template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    scheduledTimeZone: text("scheduled_time_zone"),
    meetingLocation: text("meeting_location"),
    googleEventId: text("google_event_id"),
    googleEventOwnerId: uuid("google_event_owner_id").references(() => users.id, { onDelete: "set null" }),
    googleSyncError: text("google_sync_error"),
    googleSyncFingerprint: text("google_sync_fingerprint"),
    googleEventEtag: text("google_event_etag"),
    googleRsvps: jsonb("google_rsvps").$type<{ candidate: string | null; interviewers: { userId: string; status: string }[] }>(),
    googleLastSyncedAt: timestamp("google_last_synced_at", { withTimezone: true }),
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

/** One revocable, candidate-scoped direct booking link per interview. Only its hash is stored. */
export const interviewBookingLinks = pgTable("interview_booking_links", {
  interviewId: uuid("interview_id").primaryKey().references(() => interviews.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One revocable availability request for the application's current stage. */
export const candidateAvailabilityLinks = pgTable("candidate_availability_links", {
  applicationId: uuid("application_id").primaryKey().references(() => applications.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id").notNull().references(() => stages.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Candidate-proposed windows are suggestions, not reserved interviewer time. */
export const candidateAvailabilityWindows = pgTable("candidate_availability_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id").notNull().references(() => stages.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  timeZone: text("time_zone").notNull(),
  source: text("source").notNull().default("availability_link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("candidate_availability_windows_application_idx").on(t.applicationId, t.stageId)]);

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

/**
 * Notes tied to one application (candidate + job), such as the recruiter's phone screen.
 * One per application and kind; saving again edits it. Kept when the application is
 * rejected or withdrawn, deleted with the candidate.
 */
export const applicationNotes = pgTable(
  "application_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("phone_screen"),
    body: text("body").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("application_notes_application_kind_idx").on(t.applicationId, t.kind)],
);

/**
 * In-app notifications. They point at an application or interview and store no candidate
 * details; text is rendered from current data, and rows go when the application does.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** application, stage_changed, interview_assigned */
    kind: text("kind").notNull(),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
    interviewId: uuid("interview_id").references(() => interviews.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** Non-personal context such as the stage name at the time. */
    data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

/** Folders for organizing email templates. Deleting a folder leaves its templates unfiled. */
export const emailTemplateFolders = pgTable(
  "email_template_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_template_folders_name_idx").on(sql`lower(${t.name})`)],
);

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    folderId: uuid("folder_id").references(() => emailTemplateFolders.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    /** Plain-text version, derived from `bodyHtml`. Sent as the text part of the email. */
    body: text("body").notNull(),
    /** Sanitized rich text. Empty for templates written before rich text; those fall back to `body`. */
    bodyHtml: text("body_html").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_templates_folder_idx").on(t.folderId)],
);

export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    /** Set when the email was sent automatically because the application entered this stage. */
    stageId: uuid("stage_id").references(() => stages.id, { onDelete: "set null" }),
    direction: text("direction").notNull().default("outbound"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    bodyHtml: text("body_html"),
    /** sending, sent, failed, or skipped (no SMTP, no candidate email). */
    status: text("status").notNull().default("sent"),
    error: text("error"),
    /** One automatic email per application and stage, however often the card moves. */
    triggerKey: text("trigger_key").unique(),
    sentBy: uuid("sent_by").references(() => users.id),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("emails_candidate_idx").on(t.candidateId)],
);

/** Durable, uniquely keyed scheduling mail. A sending claim is never retried automatically. */
export const schedulingDeliveries = pgTable("scheduling_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  interviewId: uuid("interview_id").references(() => interviews.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  bodyEncrypted: text("body_encrypted").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  messageId: text("message_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("scheduling_deliveries_due_idx").on(t.status, t.scheduledFor),
  index("scheduling_deliveries_application_idx").on(t.applicationId)]);

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
    /** user (signed in), api_key (a script using a key), agent (an AI agent such as the MCP server), system. */
    actorType: text("actor_type").notNull().default("user"),
    /** The API key that made the change, when it came through the API. */
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

/* ---------- Public API and webhooks ---------- */

/**
 * Keys for the public REST API (/api/v1). A key acts as one user and can never do more than
 * that user; scopes narrow it further. Only the SHA-256 of the full key is stored. The
 * prefix is the visible, non-secret part used to tell keys apart.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("api_keys_prefix_idx").on(t.prefix), uniqueIndex("api_keys_hash_idx").on(t.keyHash)],
);

/** Outgoing webhook endpoints. The signing secret is encrypted with AUTH_SECRET, since HMAC needs it back. */
export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  /** Event names, e.g. application.created. */
  events: text("events").array().notNull().default([]),
  secretEncrypted: text("secret_encrypted").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One event for one webhook, with its delivery state. Payloads hold ids and stage names
 * only, never names or contact details. Rows go when the candidate they are about does.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    /** Same for every webhook that receives this event, so receivers can de-duplicate. */
    eventId: uuid("event_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "cascade" }),
    /** pending, delivered, or failed (gave up after the last retry). */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt),
  ],
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
