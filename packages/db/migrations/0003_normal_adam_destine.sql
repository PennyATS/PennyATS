ALTER TABLE "scorecards" ALTER COLUMN "stage_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scorecards" ALTER COLUMN "recommendation" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "scorecard_attributes" text[] DEFAULT '{"Role skills","Problem solving","Communication","Ownership"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "scorecards" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "scorecards_author_stage_idx" ON "scorecards" USING btree ("application_id","author_id","stage_name");