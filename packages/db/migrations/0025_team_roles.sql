CREATE TYPE "public"."team_role" AS ENUM('hiring_manager', 'recruiter', 'coordinator', 'interviewer', 'viewer');--> statement-breakpoint
ALTER TABLE "job_team" ADD COLUMN "team_role" "team_role" DEFAULT 'interviewer' NOT NULL;--> statement-breakpoint
CREATE INDEX "job_team_user_idx" ON "job_team" USING btree ("user_id");--> statement-breakpoint
-- Existing hiring teams: the job's hiring manager and recruiter get those team roles; everyone else stays an interviewer.
UPDATE "job_team" SET "team_role" = 'recruiter' FROM "jobs" WHERE "jobs"."id" = "job_team"."job_id" AND "jobs"."recruiter_id" = "job_team"."user_id";--> statement-breakpoint
UPDATE "job_team" SET "team_role" = 'hiring_manager' FROM "jobs" WHERE "jobs"."id" = "job_team"."job_id" AND "jobs"."hiring_manager_id" = "job_team"."user_id";
