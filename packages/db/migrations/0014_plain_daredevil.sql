ALTER TABLE "interviews" ADD COLUMN "google_event_etag" text;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "google_rsvps" jsonb;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "google_last_synced_at" timestamp with time zone;