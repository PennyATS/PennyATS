# PennyATS

Open source applicant tracking system for founders, founding recruiters, and small teams. Self-hosted, bring your own Postgres, bring your own AI API key. AI features are off by default.

Status: milestone 6 (AI) done. Login with roles, invites, jobs with editable stages and hiring teams, a public careers page with apply form, privacy notice and consent, a kanban pipeline board per job with a job overview and pipeline health checks, an interview loop (interview plan per stage, interviews per candidate, scorecards tied to interviews), scorecards, candidate profiles with notes and an activity timeline, privacy tools (permanent delete, data export, retention purge, audit log), reports (funnel, time in stage, time to hire, sources, rejection reasons, interviewer activity),, opt-in AI (job description drafts, interview feedback summaries) with an admin settings page, a public REST API (/api/v1) with scoped API keys, an OpenAPI document, and signed webhooks, an MCP server for AI assistants, and an open, versioned data format with workspace export and import. No CSV import from other ATSs yet. Polish and launch is next. The UI is deliberately bare until a theme is chosen.

## Stack

- Next.js 15 (App Router), React 19, TypeScript, Tailwind v4
- Postgres via Drizzle ORM and postgres-js
- pnpm workspaces (Node 22 or newer)
- Tests: Node's built-in test runner via `tsx --test`

## Layout

```
apps/web         Next.js app (UI and API routes)
packages/db      Drizzle schema, migrations, seed
packages/ai      AI provider interface (Anthropic, OpenAI); returns null when no key is set
packages/redact  PII redaction applied before text goes to a model
packages/mcp     MCP server (stdio and streamable HTTP) that uses the public API with a scoped key
packages/schema  Open data format (zod source of truth, JSON Schema in docs/schema), workspace export and import
examples         Reference integrations (sourcing, scheduler, AI assistant) run in CI by tests/integration/examples.spec.ts
docker           Docker Compose for local Postgres
```

Packages are scoped `@pennyats/*` and are consumed from source (no build step; `next.config.ts` uses `transpilePackages`).

## Commands

```
pnpm install
pnpm dev                 # run the web app
pnpm typecheck           # all packages
pnpm build               # production build
pnpm test                # unit tests (no database needed)
pnpm privacy:purge       # delete candidates past the retention period (schedule it, e.g. daily cron)
pnpm webhooks:deliver    # send due webhook deliveries and retries (schedule it, e.g. every 5 minutes)
pnpm api:spec            # regenerate docs/api/openapi.json after changing the API
pnpm schema:generate     # regenerate docs/schema/v1 after changing the open data format
pnpm data:export --out f.json   # whole workspace in the open data format
pnpm data:import f.json         # import an open-format file (idempotent, one transaction)
pnpm test:integration    # API, webhook, and browser tests (needs TEST_DATABASE_URL: local Postgres, db name ending in _test)
pnpm db:generate         # generate a migration from schema.ts
pnpm db:migrate          # apply migrations (needs DATABASE_URL)
pnpm db:seed             # demo data (needs DATABASE_URL)
docker compose -f docker/docker-compose.yml up -d   # local Postgres
```

Copy `.env.example` to `.env` (repo root) before running anything that touches the database. The db scripts and `next.config.ts` both load the root `.env`; real environment variables win over it.

`pnpm db:seed` creates a demo login (`admin@example.com` / `pennyats-demo`) and marks setup complete. It also loads a reproducible synthetic funnel from the `synthetic-recruiting` package (`packages/db/src/seed-synthetic.ts`): 9 jobs, about 1,400 candidates, stage history, interviews and scorecards, with dates shifted so the data ends on the day you seed, plus one user per role preset (`head.of.talent@`, `ta.manager@`, `recruiter@`, `coordinator@`, `hiring.manager@`, `executive@example.com`) and six `*.interviewer@example.com` users, all with the same password. It skips itself if already loaded. On an empty database without the seed, `/setup` creates the first admin.

## Conventions

- Product name lives in `apps/web/src/lib/brand.ts`. User-facing text reads from it.
- Database: Postgres only, reached through `DATABASE_URL`. Do not add MySQL or SQLite support.
- AI is opt-in. Every AI feature gets its client from `getAiFor(feature)` in `apps/web/src/lib/ai.ts` (which wraps `getAiClient()` from `@pennyats/ai`, applies the admin's redaction setting, and returns null when AI is unconfigured or the feature is off) and hides itself on null. Check `isAiFeatureOn` before rendering a button. The app must work fully with no AI key.
- AI calls: rate limit with `allowAiCall(user.id)`, show errors with `aiErrorMessage(err)` (never raw provider responses), build prompts as pure functions in `lib/ai-rules.ts`, don't send names you don't need (feedback summaries label interviewers by number and omit the candidate), and tell the model that user-written text is data, not instructions.
- The AI key lives only in the server environment. Never store it in the database or render more than `keyHint()`.
- Never call a model provider directly from app code. Go through `@pennyats/ai` so PII redaction applies. Redaction is pattern-based (emails, phones, URLs) and does not catch names, so do not describe it as a guarantee.
- Schema changes go in `packages/db/src/schema.ts`, then `pnpm db:generate`. Commit the generated migration.
- UI: clean, responsive, dark mode supported, keyboard-friendly. Use CSS variables from `globals.css`.
- Keep dependencies minimal. Prefer small, typed helpers over new packages.
- Never commit secrets or real candidate data. Use the synthetic seed data for demos.
- Auth: every protected page, server action, and route handler calls `requireUser()` (or `getCurrentUser()` in route handlers) itself. The `(app)` layout check alone is not enough, because server actions can be called directly.
- Access is checked by named permission with `can(user, permission)` from `apps/web/src/lib/permissions.ts` (#94), never by role name; `requireUser("jobs.edit")` takes a permission. Roles are the system presets in `ROLE_PRESETS` there (#95); each user points at a `roles` row by `role_id`, and a preset's permissions come from code. `permissions-matrix.test.ts` checks every preset against the epic's matrix, so a change to a role's access must update it. Hiring team roles (`job_team.team_role`, `TEAM_ROLE_PRESETS`, #96) add permissions on one job, loaded into `user.jobPermissions` per request; so check job-scoped permissions with the job: `can(user, p, { jobId })`, and in actions `requireJobAccess` / `requireApplicationAccess` / `requireInterviewAccess` / `requireCandidateAccess` from `lib/auth.ts`, which also check visibility. Confidential jobs are left out of `visibleJobIds` for anyone not on the team without `jobs.view_confidential`; reports take `reportJobIds(user)`. Interviewers only see jobs they are on the hiring team for; use `visibleJobIds`, `canSeeJob`, and `canSeeCandidate` from `lib/hiring.ts` for any new query that lists jobs, candidates, or applications.
- Sessions and invite tokens are stored as SHA-256 hashes. Passwords use Node's built-in scrypt (`packages/db/src/password.ts`).
- Uploaded files go through `apps/web/src/lib/storage.ts` (local disk under `STORAGE_DIR`). Resumes are always served as downloads, never inline.
- Candidate emails are stored lowercased and are unique; applying or adding with an existing email reuses that candidate.
- Interview loop: a job's plan lives in `interview_templates`; a candidate's interviews (`interviews`) are created from it by `createStageInterviews` in `lib/hiring.ts` whenever they enter a stage, so anything that changes an application's stage must call it. Interviews copy name, stage and attributes so plan edits don't rewrite history. Status is derived, never stored: use `interviewStatus`/`isOverdue` in `lib/interviews.ts`. Times are entered in the browser's timezone and sent with its offset (`ScheduleInput`, `parseScheduledAt`); show times with `LocalTime`.
- Scorecards: one per interviewer per interview, or per stage when not tied to an interview (resubmitting edits it; the two unique indexes are partial, so upserts need `targetWhere`). Load the form's context with `loadScorecardContext` so the page and action agree on attributes. Interviewers can't see other scorecards on an application until they submit their own; keep that rule in `lib/scorecards.ts` and apply it anywhere scorecard content is shown, including summaries.
- Privacy: any new table holding candidate data must cascade on candidate delete (`onDelete: "cascade"`) and be added to `exportCandidate` in `lib/privacy.ts`. Never write a deleted person's details to `audit_log`.
- `lib/privacy.ts` has no Next.js imports so `scripts/privacy-purge.mts` can use it. Keep it that way.
- Raw `sql` templates don't serialize `Date` params with postgres-js; pass `date.toISOString()` and cast to `::timestamptz`.
- Reports: `lib/report-data.ts` loads raw rows for the selected job and period; `reportTables()` in `lib/reports.ts` turns them into the tables that both the page and the CSV download (`/api/reports/[table]`) use, so they can't disagree. CSV goes through `toCsv` in `lib/csv.ts`, which neutralizes spreadsheet formulas. Stage history is rebuilt from `stage_changed` activity, so anything that moves an application must log it through `logActivity`.
- Email templates: rich text from the Tiptap editor is sanitized on the server with `sanitizeEmailHtml` (`lib/email-templates.ts`) before storing; the plain-text part is derived with `htmlToText`. Merge values are escaped into HTML (`renderEmailHtml`). Send template emails through `prepareTemplateEmail` / `sendStageEntryEmail` in `lib/candidate-email.ts`, which record every attempt in `emails` (sent, failed, or skipped when SMTP is missing). Anything that moves an application to a stage must call `sendStageEntryEmail`; its `trigger_key` keeps it to one email per application and stage.
- Candidate list, search, and review: `lib/candidate-search.ts` turns URL filters into SQL (boolean query parsed by `lib/search-query.ts`) for both the candidates list and the profile's next / previous arrows, so they always agree. Links into a profile carry the list's query string. Phone screen notes live in `application_notes` (one per application and kind) and stay after a rejection; the job page's Archived view lists rejected and withdrawn applications. Rejection reasons come from the standard list in `lib/candidate-review.ts`; tags are normalized there too.
- Notifications: `notify()` in `lib/notifications.ts` (new applications and stage moves go to the job's recruiter and hiring manager, or its recruiters/admins when neither is set; interview assignments go to the interviewer). Rows store ids, not candidate details, and cascade with the application. Pass the acting user so people aren't notified about their own actions.
- Navigation lives in `components/top-nav.tsx` as dropdown folders in Ashby's layout (brand and folders left; search, Add, notifications, user right; #89); dashboards (Home, Executive, Jobs) share the `(app)/(home)` layout's Views rail; every job page shares `jobs/[id]/layout.tsx` (header, left rail, `?details=1` drawer). Charts are SVG components in `components/charts.tsx` with math in `lib/charts.ts`; use the fixed `SERIES_COLORS` order and give every chart a table toggle.
- Public API (`/api/v1`, docs in `docs/api.md`): declare each endpoint once in `lib/api/routes.ts` with zod schemas from `lib/api/schemas.ts`, and build its handler with `apiHandler(routes.x, fn)`, which does key lookup, scope and permission checks, validation, rate limiting, errors, and the audit entry. Run `pnpm api:spec` and commit `docs/api/openapi.json`; a unit test fails on drift or on a route file missing from the table. Keys act as a user: run the same `lib/` functions the UI uses (`lib/pipeline.ts`, `lib/hiring.ts`, `lib/jobs.ts`) with the key's user so visibility rules apply, and never write hiring logic inside a route or action file. New scopes go in `lib/api/scopes.ts` with the #94 permission they map to. Every API test goes in `tests/integration/api.spec.ts` with an allowed and a denied call.
- Integrations (`docs/integrations.md`, `examples/`): the examples use only the public API, webhooks, and MCP server, and `examples.spec.ts` runs them, so an API change that breaks them fails CI. Interview scheduling and state changes live in `lib/interview-ops.ts` for both the UI and the API. Paging compares and orders on millisecond-truncated times (`before` / `newestFirst` in `lib/api/data.ts`); use both for any new keyset list.
- Webhooks: queue with `queueWebhookEvent(tx, ...)` inside the transaction that makes the change, then call `deliverDueWebhooks()` after commit. Payloads carry ids and stage names only, never names, contact details, or scorecard content. New events go in `lib/webhook-events.ts`.
- MCP server (`packages/mcp`, docs in `docs/mcp.md`): it only calls the public API, never the database. New tools go in `src/tools.ts` with a kind: `read`, `write` (hidden in read-only mode, the default), or `destructive` (needs `confirm: true`, with a `preview`). Results go through `redactValue` (per string, so JSON stays valid; ids and timestamps are protected). End-to-end tests are in `apps/web/tests/integration/mcp.spec.ts`.
- Open data format (`packages/schema`, docs in `docs/schema/README.md`): a unit test fails when a column is added to a covered table, or a table is added to `@pennyats/db`, without a decision in `packages/schema/src/coverage.ts` (map it to a field, exclude it with a reason, or list the table in `NOT_IN_V1`). Changing the format: edit `src/format.ts`, `exportWorkspace`, and `importWorkspace`, bump `SCHEMA_VERSION` per the compatibility policy, add a `docs/schema/CHANGELOG.md` entry, and run `pnpm schema:generate`. `data-roundtrip.spec.ts` checks export, import into a clean database, and export again are identical.
- Audit log rows have `actor_type` (user, api_key, agent, system) and `api_key_id`. API writes are logged by `apiHandler`; requests with `X-PennyATS-Agent` are agent activity.
- Row-level security (#119, `docs/rls.md`): with `APP_DATABASE_URL` set the app connects as `pennyats_app` and `lib/db.ts` sends the acting user with every statement (bound in `getCurrentUser` and `apiHandler`). A new table holding candidate or job data needs a policy in a migration and a case in `tests/integration/rls.spec.ts`. Code that must count other people's scorecards uses `withScorecardFacts`; code that writes on others' behalf after its own permission check uses `asSystem`. `pnpm test:integration` runs the whole app under RLS.
- Exports from a `"use server"` file are callable by anyone as endpoints. Put helpers in `lib/`, not in actions files.
- Public demo (`docs/demo.md`): `isDemoMode()` in `lib/demo.ts` switches off email, AI, calendar sync, and webhooks, tightens limits, and blocks account changes. A new feature that sends anything outward or lets one visitor lock out others must check it. `pnpm demo:reset` and `pnpm db:seed` refuse real databases (`packages/db/src/demo-guard.ts`); keep those guards.
- Setup checklist (`/settings/setup`, #132): steps and plain-language wording live in `lib/setup-checklist.ts`; completion is derived from the workspace in `lib/setup-checklist-data.ts`, and only skips and "hidden from Home" are stored (settings key `setup_checklist`). Test buttons return wording from `testMessage`, never raw errors.
- Forms: React 19 resets a form after its action runs, snapping inputs back to stale defaults. For `ActionForm`, pass `resetKey` (the saved value) rather than keying the whole form, which would also wipe the "Saved." message. Plain forms: key the inputs.

## Done means

- `pnpm typecheck` and `pnpm build` pass.
- For database work, the migration was actually applied and the seed was run against a live Postgres.
- State what you ran and what passed or failed. Do not claim a check you did not run.

## Tracking

Work to do lives in GitHub issues (https://github.com/PennyATS/PennyATS/issues) on the public project board (https://github.com/orgs/PennyATS/projects/1), grouped by the milestones "Before launch", "Polish and launch", and "Later". Check there before starting work, file new gaps as issues, and reference the issue in commits. The list below is context, not the to-do list.

## Known gaps

- Unit tests cover pure logic. Integration tests (`pnpm test:integration`) cover the public API, webhooks, and one browser hiring flow against a seeded database; most UI pages have no browser test yet.
- The first-run `/setup` page has not been exercised in a browser (the dev database was seeded first).
- Rate limiting (login, apply) is in memory, per server process.
- Resume storage is local disk only; no S3-compatible option yet.
- Invites show a link to copy; email is deferred.
- Retention only runs when someone clicks "Delete now" or schedules `pnpm privacy:purge`; there is no built-in scheduler.
- Deleting a candidate doesn't remove them from database or file backups; self-hosters handle backup expiry.
- Reports compute in memory over the selected period. Fine for small teams; a very large instance would want SQL aggregation.
- AI features were tested against a local fake of the Anthropic API, not a real provider. Check with a real key before announcing them. The OpenAI default model (`gpt-4o-mini`) may be dated; it can be overridden with `AI_MODEL`.
- AI results aren't saved; a feedback summary is regenerated each time.
- Applications created before activity logging existed (the original seed) have no stage history, so their starting stage is assumed to be their current one.
- Kanban drag and drop uses native HTML5 drag events, which don't fire on touch screens; the arrow buttons cover touch and keyboard.
- License is not chosen yet (MIT or AGPL). Do not add a license file without asking.

## Roadmap

The long-term direction, with linked issues, lives in [ROADMAP.md](ROADMAP.md). Read it before planning work. The GitHub issues and project board are the live status.

1. Foundation (done)
2. Auth (roles: admin, recruiter, interviewer), jobs create and edit, public careers page, applications, candidate profile (done)
3. Pipeline kanban and scorecards (done)
4. Privacy: candidate delete, data export, privacy notice and consent, retention, audit log, AI redaction fix (done)
5. Reporting (done)
6. AI layer and settings page (provider, key, redaction toggle) (done)
7. Polish, docs, demo site, launch

Later (on the roadmap, not scheduled): email (candidate and team messages, invite emails), CSV import from Greenhouse and other ATSs. The target user is often adopting their first ATS, so import isn't urgent.

Deferred: interview scheduling with calendar sync, offers and e-sign, job board distribution, Chrome extension, resume parsing, multi-tenant hosting.

## Next up

Milestone 7: polish, docs, demo site, launch. Choosing the license (MIT or AGPL) is part of this; ask before adding one.
