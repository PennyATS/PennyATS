CREATE TABLE "careers_funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "careers_funnel_events" ADD CONSTRAINT "careers_funnel_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "careers_funnel_events_job_created_idx" ON "careers_funnel_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "careers_funnel_events_kind_created_idx" ON "careers_funnel_events" USING btree ("kind","created_at");