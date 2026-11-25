# PennyATS

Open source applicant tracking system for founders, founding recruiters, and small teams. Self-hosted, bring your own Postgres, bring your own AI API key. AI features are off by default.

Status: early scaffold (milestone 1, foundation). The app shell, database schema, AI provider layer, and PII redaction exist. There is no auth, jobs, careers page, or pipeline UI yet.

## Stack

- Next.js 15 (App Router), React 19, TypeScript, Tailwind v4
- Postgres via Drizzle ORM and postgres-js
- pnpm workspaces (Node 20 or newer)

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
pnpm db:generate         # generate a migration from schema.ts
pnpm db:migrate          # apply migrations (needs DATABASE_URL)
pnpm db:seed             # demo data (needs DATABASE_URL)
docker compose -f docker/docker-compose.yml up -d   # local Postgres
```

Copy `.env.example` to `.env` before running anything that touches the database.

## Conventions

- Product name lives in `apps/web/src/lib/brand.ts`. User-facing text reads from it.
- Database: Postgres only, reached through `DATABASE_URL`. Do not add MySQL or SQLite support.
- AI is opt-in. Every AI feature must call `getAiClient()` from `@pennyats/ai` and hide itself when it returns null. The app must work fully with no AI key.
- Never call a model provider directly from app code. Go through `@pennyats/ai` so PII redaction applies. Redaction is pattern-based (emails, phones, URLs) and does not catch names, so do not describe it as a guarantee.
- Schema changes go in `packages/db/src/schema.ts`, then `pnpm db:generate`. Commit the generated migration.
- UI: clean, responsive, dark mode supported, keyboard-friendly. Use CSS variables from `globals.css`.
- Keep dependencies minimal. Prefer small, typed helpers over new packages.
- Never commit secrets or real candidate data. Use the synthetic seed data for demos.

## Done means

- `pnpm typecheck` and `pnpm build` pass.
- For database work, the migration was actually applied and the seed was run against a live Postgres.
- State what you ran and what passed or failed. Do not claim a check you did not run.

## Known gaps

- The migration and seed have never been run against a live Postgres. Do this first.
- No tests yet.
- No `migrations/` folder is committed. Generate it with `pnpm db:generate`, then commit it.
- License is not chosen yet (MIT or AGPL). Do not add a license file without asking.

## Roadmap

1. Foundation (done)
2. Auth (roles: admin, recruiter, interviewer), jobs create and edit, public careers page, applications, candidate profile
3. Pipeline kanban and scorecards
4. Email, reporting, Greenhouse CSV import
5. AI layer and settings page (provider, key, redaction toggle)
6. Polish, docs, demo site, launch

Deferred: interview scheduling with calendar sync, offers and e-sign, job board distribution, Chrome extension, resume parsing, multi-tenant hosting.

## Next up

Milestone 2. Start by verifying the database (migrate and seed against local Postgres), then add auth, then jobs and the careers page.
