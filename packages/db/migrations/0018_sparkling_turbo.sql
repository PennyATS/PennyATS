ALTER TABLE "jobs" ADD COLUMN "employment_type" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "workplace_type" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "requisition_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "comp_currency" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "comp_period" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "comp_min" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "comp_mid" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "comp_max" integer;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "comp_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "equity_note" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "hiring_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "recruiter_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "target_start_date" date;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "confidential" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "internal_notes" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_hiring_manager_id_users_id_fk" FOREIGN KEY ("hiring_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_recruiter_id_users_id_fk" FOREIGN KEY ("recruiter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;