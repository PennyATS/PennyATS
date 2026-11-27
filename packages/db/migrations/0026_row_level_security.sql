-- Row-level security (#119): defense in depth for candidate and job data.
--
-- The web app connects as a separate role that cannot bypass RLS (see `pnpm db:app-role` and
-- docs/rls.md). Before each statement it sets, for that transaction only:
--   pennyats.actor_id  the signed-in user (or the API key's user), or empty
--   pennyats.flags     comma list: view_all_jobs, view_confidential, view_all_scorecards,
--                      phone_screen_read from the user's role; system for work with no user
--                      (careers page, booking links, background jobs); scorecard_facts for the
--                      few queries that count other people's scorecards without showing them.
-- Table owners (migrations, seeds, scripts) are not subject to these policies. With neither an
-- actor nor the system flag, every policy denies.
-- Helper functions are SECURITY DEFINER so policies can look at other protected tables
-- without recursing into their policies.

CREATE OR REPLACE FUNCTION pennyats_actor() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('pennyats.actor_id', true), '')::uuid
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pennyats_flag(name text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT name = ANY (string_to_array(coalesce(current_setting('pennyats.flags', true), ''), ','))
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pennyats_is_system() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT pennyats_actor() IS NULL AND pennyats_flag('system')
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pennyats_team_role(job uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT team_role::text FROM job_team WHERE job_id = job AND user_id = pennyats_actor()
$$;--> statement-breakpoint
-- Same rule as visibleJobIds in apps/web/src/lib/hiring.ts, plus the job's creator.
CREATE OR REPLACE FUNCTION pennyats_can_see_job(job uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pennyats_is_system() OR (pennyats_actor() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM job_team t WHERE t.job_id = job AND t.user_id = pennyats_actor())
    OR EXISTS (SELECT 1 FROM jobs j WHERE j.id = job AND j.created_by = pennyats_actor())
    OR (pennyats_flag('view_all_jobs') AND (
      pennyats_flag('view_confidential') OR NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = job AND j.confidential)
    ))
  ))
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pennyats_application_job(app uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT job_id FROM applications WHERE id = app
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pennyats_can_see_application(app uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pennyats_is_system() OR coalesce(pennyats_can_see_job(pennyats_application_job(app)), false)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pennyats_can_see_interview(i uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pennyats_is_system() OR EXISTS (
    SELECT 1 FROM interviews iv WHERE iv.id = i AND pennyats_can_see_application(iv.application_id)
  )
$$;--> statement-breakpoint
-- A candidate is visible through an application on a visible job. Candidates with no
-- application at all are visible to people who see every job.
CREATE OR REPLACE FUNCTION pennyats_can_see_candidate(c uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pennyats_is_system() OR (pennyats_actor() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = c AND pennyats_can_see_job(a.job_id))
    OR (pennyats_flag('view_all_jobs') AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = c))
  ))
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pennyats_has_submitted(app uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM scorecards s WHERE s.application_id = app AND s.author_id = pennyats_actor())
$$;--> statement-breakpoint
-- Blind review: other people's scorecards need scorecards.view_all (role or team role), your own
-- submitted scorecard on the same application, or the scorecard_facts flag.
CREATE OR REPLACE FUNCTION pennyats_can_see_scorecard(app uuid, author uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pennyats_is_system() OR (pennyats_can_see_application(app) AND (
    author = pennyats_actor()
    OR pennyats_flag('view_all_scorecards')
    OR pennyats_flag('scorecard_facts')
    OR coalesce(pennyats_team_role(pennyats_application_job(app)) IN ('hiring_manager', 'recruiter'), false)
    OR pennyats_has_submitted(app)
  ))
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION pennyats_can_read_phone_screens(app uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pennyats_is_system() OR (pennyats_can_see_application(app) AND (
    pennyats_flag('phone_screen_read')
    OR coalesce(pennyats_team_role(pennyats_application_job(app)) IN ('hiring_manager', 'recruiter', 'coordinator'), false)
  ))
$$;--> statement-breakpoint

ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "jobs_select" ON "jobs";--> statement-breakpoint
CREATE POLICY "jobs_select" ON "jobs" FOR SELECT USING (pennyats_can_see_job(id) OR created_by = pennyats_actor());--> statement-breakpoint
DROP POLICY IF EXISTS "jobs_insert" ON "jobs";--> statement-breakpoint
CREATE POLICY "jobs_insert" ON "jobs" FOR INSERT WITH CHECK (pennyats_is_system() OR pennyats_actor() IS NOT NULL);--> statement-breakpoint
DROP POLICY IF EXISTS "jobs_update" ON "jobs";--> statement-breakpoint
CREATE POLICY "jobs_update" ON "jobs" FOR UPDATE USING (pennyats_can_see_job(id)) WITH CHECK (pennyats_can_see_job(id) OR created_by = pennyats_actor());--> statement-breakpoint
DROP POLICY IF EXISTS "jobs_delete" ON "jobs";--> statement-breakpoint
CREATE POLICY "jobs_delete" ON "jobs" FOR DELETE USING (pennyats_can_see_job(id));--> statement-breakpoint

ALTER TABLE "stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "stages_job" ON "stages";--> statement-breakpoint
CREATE POLICY "stages_job" ON "stages" USING (pennyats_can_see_job(job_id)) WITH CHECK (pennyats_can_see_job(job_id));--> statement-breakpoint

ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "applications_job" ON "applications";--> statement-breakpoint
CREATE POLICY "applications_job" ON "applications" USING (pennyats_can_see_job(job_id)) WITH CHECK (pennyats_can_see_job(job_id));--> statement-breakpoint

ALTER TABLE "candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "candidates_select" ON "candidates";--> statement-breakpoint
CREATE POLICY "candidates_select" ON "candidates" FOR SELECT USING (pennyats_can_see_candidate(id));--> statement-breakpoint
DROP POLICY IF EXISTS "candidates_insert" ON "candidates";--> statement-breakpoint
CREATE POLICY "candidates_insert" ON "candidates" FOR INSERT WITH CHECK (pennyats_is_system() OR pennyats_actor() IS NOT NULL);--> statement-breakpoint
DROP POLICY IF EXISTS "candidates_update" ON "candidates";--> statement-breakpoint
CREATE POLICY "candidates_update" ON "candidates" FOR UPDATE USING (pennyats_can_see_candidate(id)) WITH CHECK (pennyats_is_system() OR pennyats_actor() IS NOT NULL);--> statement-breakpoint
DROP POLICY IF EXISTS "candidates_delete" ON "candidates";--> statement-breakpoint
CREATE POLICY "candidates_delete" ON "candidates" FOR DELETE USING (pennyats_can_see_candidate(id));--> statement-breakpoint

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notes_candidate" ON "notes";--> statement-breakpoint
CREATE POLICY "notes_candidate" ON "notes" USING (pennyats_can_see_candidate(candidate_id)) WITH CHECK (pennyats_can_see_candidate(candidate_id));--> statement-breakpoint

ALTER TABLE "emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "emails_candidate" ON "emails";--> statement-breakpoint
CREATE POLICY "emails_candidate" ON "emails" USING (pennyats_can_see_candidate(candidate_id)) WITH CHECK (pennyats_can_see_candidate(candidate_id));--> statement-breakpoint

ALTER TABLE "scheduling_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "scheduling_deliveries_candidate" ON "scheduling_deliveries";--> statement-breakpoint
CREATE POLICY "scheduling_deliveries_candidate" ON "scheduling_deliveries" USING (pennyats_can_see_candidate(candidate_id)) WITH CHECK (pennyats_can_see_candidate(candidate_id));--> statement-breakpoint

ALTER TABLE "application_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "application_notes_phone_screen" ON "application_notes";--> statement-breakpoint
CREATE POLICY "application_notes_phone_screen" ON "application_notes" USING (pennyats_can_read_phone_screens(application_id)) WITH CHECK (pennyats_can_read_phone_screens(application_id));--> statement-breakpoint

ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "activity_application" ON "activity";--> statement-breakpoint
CREATE POLICY "activity_application" ON "activity"
  USING (pennyats_is_system() OR (pennyats_actor() IS NOT NULL AND (application_id IS NULL OR pennyats_can_see_application(application_id))))
  WITH CHECK (pennyats_is_system() OR (pennyats_actor() IS NOT NULL AND (application_id IS NULL OR pennyats_can_see_application(application_id))));--> statement-breakpoint

ALTER TABLE "interviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "interviews_application" ON "interviews";--> statement-breakpoint
CREATE POLICY "interviews_application" ON "interviews" USING (pennyats_can_see_application(application_id)) WITH CHECK (pennyats_can_see_application(application_id));--> statement-breakpoint

ALTER TABLE "interview_interviewers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "interview_interviewers_interview" ON "interview_interviewers";--> statement-breakpoint
CREATE POLICY "interview_interviewers_interview" ON "interview_interviewers" USING (pennyats_can_see_interview(interview_id)) WITH CHECK (pennyats_can_see_interview(interview_id));--> statement-breakpoint

ALTER TABLE "interview_booking_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "interview_booking_links_interview" ON "interview_booking_links";--> statement-breakpoint
CREATE POLICY "interview_booking_links_interview" ON "interview_booking_links" USING (pennyats_can_see_interview(interview_id)) WITH CHECK (pennyats_can_see_interview(interview_id));--> statement-breakpoint

ALTER TABLE "candidate_availability_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "candidate_availability_links_application" ON "candidate_availability_links";--> statement-breakpoint
CREATE POLICY "candidate_availability_links_application" ON "candidate_availability_links" USING (pennyats_can_see_application(application_id)) WITH CHECK (pennyats_can_see_application(application_id));--> statement-breakpoint

ALTER TABLE "candidate_availability_windows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "candidate_availability_windows_application" ON "candidate_availability_windows";--> statement-breakpoint
CREATE POLICY "candidate_availability_windows_application" ON "candidate_availability_windows" USING (pennyats_can_see_application(application_id)) WITH CHECK (pennyats_can_see_application(application_id));--> statement-breakpoint

ALTER TABLE "scorecards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "scorecards_select" ON "scorecards";--> statement-breakpoint
CREATE POLICY "scorecards_select" ON "scorecards" FOR SELECT USING (pennyats_can_see_scorecard(application_id, author_id));--> statement-breakpoint
DROP POLICY IF EXISTS "scorecards_insert" ON "scorecards";--> statement-breakpoint
CREATE POLICY "scorecards_insert" ON "scorecards" FOR INSERT WITH CHECK (pennyats_is_system() OR (author_id = pennyats_actor() AND pennyats_can_see_application(application_id)));--> statement-breakpoint
DROP POLICY IF EXISTS "scorecards_update" ON "scorecards";--> statement-breakpoint
CREATE POLICY "scorecards_update" ON "scorecards" FOR UPDATE USING (pennyats_is_system() OR author_id = pennyats_actor()) WITH CHECK (pennyats_is_system() OR (author_id = pennyats_actor() AND pennyats_can_see_application(application_id)));--> statement-breakpoint
DROP POLICY IF EXISTS "scorecards_delete" ON "scorecards";--> statement-breakpoint
CREATE POLICY "scorecards_delete" ON "scorecards" FOR DELETE USING (pennyats_is_system() OR author_id = pennyats_actor() OR (pennyats_flag('view_all_scorecards') AND pennyats_can_see_application(application_id)));
