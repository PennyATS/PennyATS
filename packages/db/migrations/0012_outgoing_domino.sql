CREATE TABLE "interview_booking_links" (
	"interview_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_booking_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD COLUMN "working_time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD COLUMN "working_days" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD COLUMN "work_start_minute" integer DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD COLUMN "work_end_minute" integer DEFAULT 1020 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_booking_links" ADD CONSTRAINT "interview_booking_links_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;