# PennyATS

Open source applicant tracking system for founders, founding recruiters, and small teams. Self-hosted, bring your own Postgres, bring your own AI API key. AI features are off by default.

Status: milestone 6 (AI) done. Login with roles, invites, jobs with editable stages and hiring teams, a public careers page with apply form, privacy notice and consent, a kanban pipeline board per job with a job overview and pipeline health checks, an interview loop (interview plan per stage, interviews per candidate, scorecards tied to interviews), scorecards, candidate profiles with notes and an activity timeline, privacy tools (permanent delete, data export, retention purge, audit log), reports (funnel, time in stage, time to hire, sources, rejection reasons, interviewer activity), and opt-in AI (job description drafts, interview feedback summaries) with an admin settings page. No email or import yet. Polish and launch is next. The UI is deliberately bare until a theme is chosen.

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
pnpm db:generate         # generate a migration from schema.ts
pnpm db:migrate          # apply migrations (needs DATABASE_URL)
pnpm db:seed             # demo data (needs DATABASE_URL)
docker compose -f docker/docker-compose.yml up -d   # local Postgres
```

Copy `.env.example` to `.env` (repo root) before running anything that touches the database. The db scripts and `next.config.ts` both load the root `.env`; real environment variables win over it.

`pnpm db:seed` creates a demo login (`admin@example.com` / `pennyats-demo`) and marks setup complete. It also loads a reproducible synthetic funnel from the `synthetic-recruiting` package (`packages/db/src/seed-synthetic.ts`): 9 jobs, about 1,400 candidates, stage history, interviews and scorecards, with dates shifted so the data ends on the day you seed, plus `recruiter@example.com` and six `*.interviewer@example.com` users with the same password. It skips itself if already loaded. On an empty database without the seed, `/setup` creates the first admin.

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
- Roles live in `apps/web/src/lib/permissions.ts`. Interviewers only see jobs they are on the hiring team for; use `visibleJobIds`, `canSeeJob`, and `canSeeCandidate` from `lib/hiring.ts` for any new query that lists jobs, candidates, or applications.
- Sessions and invite tokens are stored as SHA-256 hashes. Passwords use Node's built-in scrypt (`packages/db/src/password.ts`).
- Uploaded files go through `apps/web/src/lib/storage.ts` (local disk under `STORAGE_DIR`). Resumes are always served as downloads, never inline.
- Candidate emails are stored lowercased and are unique; applying or adding with an existing email reuses that candidate.
- Interview loop: a job's plan lives in `interview_templates`; a candidate's interviews (`interviews`) are created from it by `createStageInterviews` in `lib/hiring.ts` whenever they enter a stage, so anything that changes an application's stage must call it. Interviews copy name, stage and attributes so plan edits don't rewrite history. Status is derived, never stored: use `interviewStatus`/`isOverdue` in `lib/interviews.ts`. Times are entered in the browser's timezone and sent with its offset (`ScheduleInput`, `parseScheduledAt`); show times with `LocalTime`.
- Scorecards: one per interviewer per interview, or per stage when not tied to an interview (resubmitting edits it; the two unique indexes are partial, so upserts need `targetWhere`). Load the form's context with `loadScorecardContext` so the page and action agree on attributes. Interviewers can't see other scorecards on an application until they submit their own; keep that rule in `lib/scorecards.ts` and apply it anywhere scorecard content is shown, including summaries.
- Privacy: any new table holding candidate data must cascade on candidate delete (`onDelete: "cascade"`) and be added to `exportCandidate` in `lib/privacy.ts`. Never write a deleted person's details to `audit_log`.
- `lib/privacy.ts` has no Next.js imports so `scripts/privacy-purge.mts` can use it. Keep it that way.
- Raw `sql` templates don't serialize `Date` params with postgres-js; pass `date.toISOString()` and cast to `::timestamptz`.
- Reports: `lib/report-data.ts` loads raw rows for the selected job and period; `reportTables()` in `lib/reports.ts` turns them into the tables that both the page and the CSV download (`/api/reports/[table]`) use, so they can't disagree. CSV goes through `toCsv` in `lib/csv.ts`, which neutralizes spreadsheet formulas. Stage history is rebuilt from `stage_changed` activity, so anything that moves an application must log it through `logActivity`.
- Exports from a `"use server"` file are callable by anyone as endpoints. Put helpers in `lib/`, not in actions files.
- Forms: React 19 resets a form after its action runs, snapping inputs back to stale defaults. For `ActionForm`, pass `resetKey` (the saved value) rather than keying the whole form, which would also wipe the "Saved." message. Plain forms: key the inputs.

## Done means

- `pnpm typecheck` and `pnpm build` pass.
- For database work, the migration was actually applied and the seed was run against a live Postgres.
- State what you ran and what passed or failed. Do not claim a check you did not run.

## Tracking

Work to do lives in GitHub issues (https://github.com/PennyATS/PennyATS/issues) on the public project board (https://github.com/orgs/PennyATS/projects/1), grouped by the milestones "Before launch", "Polish and launch", and "Later". Check there before starting work, file new gaps as issues, and reference the issue in commits. The list below is context, not the to-do list.

## Known gaps

- Unit tests cover pure logic only (passwords, validation, roles, rate limiting). No database or browser tests yet.
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
