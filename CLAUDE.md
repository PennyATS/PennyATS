# PennyATS

Open source applicant tracking system for founders, founding recruiters, and small teams. Self-hosted, bring your own Postgres, bring your own AI API key. AI features are off by default.

Status: milestone 2 done. Login with roles, invites, jobs with editable stages and hiring teams, a public careers page with apply form and resume upload, applications, and candidate profiles with notes and an activity timeline. No kanban, scorecards, email, or reporting yet. The UI is deliberately bare until a theme is chosen.

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
pnpm db:generate         # generate a migration from schema.ts
pnpm db:migrate          # apply migrations (needs DATABASE_URL)
pnpm db:seed             # demo data (needs DATABASE_URL)
docker compose -f docker/docker-compose.yml up -d   # local Postgres
```

Copy `.env.example` to `.env` (repo root) before running anything that touches the database. The db scripts and `next.config.ts` both load the root `.env`; real environment variables win over it.

`pnpm db:seed` creates a demo login (`admin@example.com` / `pennyats-demo`) and marks setup complete. On an empty database without the seed, `/setup` creates the first admin.

## Conventions

- Product name lives in `apps/web/src/lib/brand.ts`. User-facing text reads from it.
- Database: Postgres only, reached through `DATABASE_URL`. Do not add MySQL or SQLite support.
- AI is opt-in. Every AI feature must call `getAiClient()` from `@pennyats/ai` and hide itself when it returns null. The app must work fully with no AI key.
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
- Forms: React 19 resets a form after its action runs. Key inputs (or the form) on the saved value so they don't snap back to stale defaults.

## Done means

- `pnpm typecheck` and `pnpm build` pass.
- For database work, the migration was actually applied and the seed was run against a live Postgres.
- State what you ran and what passed or failed. Do not claim a check you did not run.

## Known gaps

- Unit tests cover pure logic only (passwords, validation, roles, rate limiting). No database or browser tests yet.
- The first-run `/setup` page has not been exercised in a browser (the dev database was seeded first).
- Rate limiting (login, apply) is in memory, per server process.
- Resume storage is local disk only; no S3-compatible option yet.
- Invites show a link to copy; nothing is emailed until milestone 4.
- License is not chosen yet (MIT or AGPL). Do not add a license file without asking.

## Roadmap

1. Foundation (done)
2. Auth (roles: admin, recruiter, interviewer), jobs create and edit, public careers page, applications, candidate profile (done)
3. Pipeline kanban and scorecards
4. Email, reporting, Greenhouse CSV import
5. AI layer and settings page (provider, key, redaction toggle)
6. Polish, docs, demo site, launch

Deferred: interview scheduling with calendar sync, offers and e-sign, job board distribution, Chrome extension, resume parsing, multi-tenant hosting.

## Next up

Milestone 3: pipeline kanban and scorecards. Wait for the plan to be approved before building.
