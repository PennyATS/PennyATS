CREATE TABLE "interview_interviewers" (
	"interview_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "interview_interviewers_interview_id_user_id_pk" PRIMARY KEY("interview_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "interview_template_interviewers" (
	"template_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "interview_template_interviewers_template_id_user_id_pk" PRIMARY KEY("template_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "interview_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"attributes" text[] DEFAULT '{}' NOT NULL,
	"instructions" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"template_id" uuid,
	"stage_id" uuid,
	"name" text NOT NULL,
	"stage_name" text NOT NULL,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"attributes" text[] DEFAULT '{}' NOT NULL,
	"instructions" text,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "scorecards_author_stage_idx";--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "interview_id" uuid;--> statement-breakpoint
ALTER TABLE "interview_interviewers" ADD CONSTRAINT "interview_interviewers_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_interviewers" ADD CONSTRAINT "interview_interviewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_template_interviewers" ADD CONSTRAINT "interview_template_interviewers_template_id_interview_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."interview_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_template_interviewers" ADD CONSTRAINT "interview_template_interviewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_templates" ADD CONSTRAINT "interview_templates_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_templates" ADD CONSTRAINT "interview_templates_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_template_id_interview_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."interview_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_interviewers_user_idx" ON "interview_interviewers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "interview_templates_stage_idx" ON "interview_templates" USING btree ("stage_id","position");--> statement-breakpoint
CREATE INDEX "interviews_application_idx" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interviews_application_template_idx" ON "interviews" USING btree ("application_id","template_id");--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scorecards_author_interview_idx" ON "scorecards" USING btree ("interview_id","author_id") WHERE "scorecards"."interview_id" is not null;--> statement-breakpoint
CREATE INDEX "scorecards_application_idx" ON "scorecards" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecards_author_stage_idx" ON "scorecards" USING btree ("application_id","author_id","stage_name") WHERE "scorecards"."interview_id" is null;