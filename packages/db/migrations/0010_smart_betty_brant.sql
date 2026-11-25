CREATE TABLE "google_calendar_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "google_event_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "interviews" ADD COLUMN "google_sync_error" text;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_google_event_owner_id_users_id_fk" FOREIGN KEY ("google_event_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;