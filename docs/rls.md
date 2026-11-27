# Row-level security

PennyATS checks access in application code (`can()`, `visibleJobIds`, and the blind scorecard rule). Postgres row-level security (RLS) enforces the same job boundaries again in the database, so a bug in one server action or API route cannot read or change another job's candidates. Tracked in [#119](https://github.com/PennyATS/PennyATS/issues/119).

## How it works

- **Two database roles.** Migrations, seeds, and scripts run as the database owner (`DATABASE_URL`). The web app connects as `pennyats_app` (`APP_DATABASE_URL`), which can read and write rows but is not a superuser, does not own tables, and has `NOBYPASSRLS`.
- **The acting user travels with every statement.** With `APP_DATABASE_URL` set, each statement runs in a short transaction that first sets `pennyats.actor_id` (the signed-in user, or the user an API key acts as) and `pennyats.flags` (what their role allows: see every job, see confidential jobs, read all scorecards, read phone screen notes). The settings are transaction-local, so a pooled connection never carries one request's user into another. Pages and server actions bind the user in `getCurrentUser()`; API routes (and so the MCP server) bind it in `apiHandler`.
- **Policies** (migration `0026_row_level_security.sql`) cover `jobs`, `stages`, `candidates`, `applications`, `application_notes`, `notes`, `scorecards`, `interviews`, `interview_interviewers`, `interview_booking_links`, `candidate_availability_links`, `candidate_availability_windows`, `activity`, `emails`, and `scheduling_deliveries`:
  - Jobs and everything under them are visible when the user is on the job's hiring team, created it, or can see every job (`jobs.view_all`). Confidential jobs also need `jobs.view_confidential` unless the user is on the team.
  - Candidates are visible through an application on a visible job.
  - Scorecards: your own, or others' when you hold `scorecards.view_all` (by role or as the job's hiring manager or recruiter) or have submitted your own on that application (blind review).
  - Phone screen notes need `notes.phone_screen.read` (by role, or as the job's hiring manager, recruiter, or coordinator).
  - Writes need the same visibility, and scorecards can only be written by their author.
- **No user means no rows.** With neither an acting user nor the `system` flag, every policy returns nothing. Work with no signed-in user (the careers page, candidate booking links, webhook delivery) runs with the `system` flag.
- **Deliberate exceptions, in code:** `withScorecardFacts()` lets a block count other people's scorecards and see who submitted (job board counts, interview status, report tallies, the API's `hidden_count`) without showing their content; `asSystem()` runs the admin's workspace import, which writes records on other people's behalf.

## What it does not cover

- **Columns.** RLS works on rows. Pay fields on a visible job are hidden by the app (`jobs.view_compensation`), not by the database.
- **Route handlers outside the API** (`/api/reports/...` CSV, candidate and workspace export) check permissions in code; if React's request cache is not available there, their queries run with the `system` flag.
- **Owner connections.** Anything run as the owner (migrations, `pnpm db:seed`, `pnpm privacy:purge`, `pnpm webhooks:deliver`, `pnpm data:export`) is not subject to RLS.
- **Without `APP_DATABASE_URL`** the app connects as the owner and only the application's checks apply. Development setups can run that way; production should not.

## Setting it up

Docker Compose does this for you: the `migrate` service runs `pnpm db:migrate && pnpm db:app-role`, and the app connects as `pennyats_app`. Set `APP_DB_PASSWORD` in `.env` (it defaults to `POSTGRES_PASSWORD`). If the password needs URL encoding, also set `COMPOSE_APP_DATABASE_URL`.

Anywhere else:

```sh
# As the owner that runs migrations
DATABASE_URL=postgres://owner:...@host/db pnpm db:migrate
DATABASE_URL=postgres://owner:...@host/db APP_DB_PASSWORD='a long random password' pnpm db:app-role
# Then run the app with
APP_DATABASE_URL=postgres://pennyats_app:<password>@host/db
```

`pnpm db:app-role` is safe to run again after each upgrade; it updates the password and grants. Tables added by later migrations inherit the grants through default privileges.

## Bring-your-own Postgres requirements

- Postgres 13 or newer (developed and tested on 18).
- The migration role owns the PennyATS tables and functions. RLS is enabled but not forced, so the owner is exempt; the policy helper functions run as `SECURITY DEFINER` under that owner.
- Something must create `pennyats_app` with `LOGIN NOSUPERUSER NOBYPASSRLS`. `pnpm db:app-role` does it when the owner has `CREATEROLE`. On managed services where it doesn't (or where roles are created in a dashboard), create the role there, make sure it does **not** have `BYPASSRLS` and is not a member of an admin role that has it (for example Supabase's `service_role` or `postgres`, or Neon's `neon_superuser`), then run `pnpm db:app-role` to apply the grants, or apply them by hand from `packages/db/src/app-role.ts`.
- Connection poolers in transaction mode (PgBouncer, Supavisor, Neon's pooler) are fine: the settings are transaction-local.

## Performance

Each statement becomes a small transaction (`begin`, `set_config`, the query, `commit`), and policies call helper functions per row. The CI integration run times the main list queries on the seeded dataset (9 jobs, about 1,400 candidates) as the owner and as the restricted role; see `tests/integration/rls.spec.ts`. Results from CI on a local Postgres 18 service container:

RESULTS_PLACEHOLDER

For small teams the overhead is a few milliseconds per page. A very large instance would want indexes on `job_team (user_id)` (added in #96) and `applications (candidate_id)`, and may prefer a per-request transaction over per-statement ones.

## Tests

`apps/web/tests/integration/rls.spec.ts` connects as `pennyats_app` and, for interviewer, recruiter, coordinator, and admin flags, attempts cross-job reads, updates, deletes, and inserts and expects them to be denied or to touch nothing, checks blind review before and after submitting, and checks that confidential jobs stay hidden. The rest of the integration suite (`pnpm test:integration`) runs the whole app as `pennyats_app`, so every browser and API test also exercises the policies.
