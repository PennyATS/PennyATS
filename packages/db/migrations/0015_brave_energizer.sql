CREATE TABLE "scheduling_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"application_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"interview_id" uuid,
	"kind" text NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_encrypted" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"message_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduling_deliveries_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "stage_scheduling_settings" (
	"stage_id" uuid PRIMARY KEY NOT NULL,
	"auto_link_mode" text DEFAULT 'none' NOT NULL,
	"reminder_minutes" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduling_deliveries" ADD CONSTRAINT "scheduling_deliveries_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_deliveries" ADD CONSTRAINT "scheduling_deliveries_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_deliveries" ADD CONSTRAINT "scheduling_deliveries_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_scheduling_settings" ADD CONSTRAINT "stage_scheduling_settings_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduling_deliveries_due_idx" ON "scheduling_deliveries" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduling_deliveries_application_idx" ON "scheduling_deliveries" USING btree ("application_id");