# PennyATS

Open source applicant tracking for founders, founding recruiters, and small teams. Self-host it, bring your own Postgres database, and optionally bring your own AI API key. AI features are off by default.

> Status: milestone 2 of 6. The core hiring loop works end to end; the pipeline board, scorecards, email, and reporting are next. The UI is intentionally plain until the visual design is settled.

## What works today

- **Sign in and roles.** First-run setup creates the admin. Admins invite teammates as admin, recruiter, or interviewer. Interviewers only see jobs they're on the hiring team for.
- **Jobs.** Create and edit jobs as draft, open, or closed. Each job has its own pipeline stages (rename, reorder, add, remove) and hiring team.
- **Careers page.** Open jobs are listed at `/careers` with an apply form and resume upload. Includes basic spam protection.
- **Applications.** Candidates are matched by email, so someone applying to a second role keeps one profile. Recruiters can add candidates by hand, move them between stages, reject with a reason, or mark them withdrawn.
- **Candidate profiles.** Contact details, resume download, every application, notes, and an activity timeline.

## Quick start

Requires Node 22+ and pnpm (`corepack enable` gives you the right version).

```bash
pnpm install
cp .env.example .env
```

Point `DATABASE_URL` in `.env` at any Postgres: a free [Neon](https://neon.tech) or Supabase database, RDS, or local Docker:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Then create the tables and start the app:

```bash
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000 and you'll be asked to create the first admin account.

### Demo data

To try it with sample data instead, run `pnpm db:seed` after migrating. It adds one job, three made-up candidates, and a demo login: `admin@example.com` / `pennyats-demo`. Only use the seed on a throwaway database.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Any Postgres connection string. Required. |
| `APP_URL` | Public URL of the app, used in invite links. Use `https://` in production so the login cookie is marked Secure. |
| `STORAGE_DIR` | Where uploaded resumes are saved. Defaults to `apps/web/.data/uploads`. Back it up along with your database. |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | Optional. Leave blank to keep every AI feature hidden. |
| `AI_REDACT_PII` | Defaults to `true`. Strips emails, phone numbers, and links before text is sent to a model. It's pattern-based and doesn't catch names. |

## Development

```bash
pnpm typecheck     # all packages
pnpm test          # unit tests (no database needed)
pnpm build         # production build
pnpm db:generate   # after changing packages/db/src/schema.ts; commit the migration
```

```
apps/web         Next.js app (UI, server actions, API routes)
packages/db      Drizzle schema, migrations, seed, password hashing
packages/ai      Provider interface (Anthropic, OpenAI), off unless configured
packages/redact  PII redaction before AI calls
docker           Local Postgres via Docker Compose
```

## Roadmap

1. Foundation ✓
2. Auth, jobs, careers page, applications, candidate profiles ✓
3. Pipeline kanban and scorecards
4. Email, reporting, Greenhouse CSV import
5. AI features and settings page
6. Polish, docs, demo site, launch

Not planned for now: interview scheduling with calendar sync, offers and e-sign, job board distribution, a Chrome extension, resume parsing, and hosted multi-tenant.
