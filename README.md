# PennyATS

Open source applicant tracking for founders, founding recruiters, and small teams. Bring your own Postgres database and your own AI API key. AI features are off by default.

> Status: early scaffold (milestone 1, foundation). No jobs, careers page, or pipeline UI yet.

## What is here

```
apps/web         Next.js app (UI, API routes)
packages/db      Drizzle schema, migrations, seed
packages/ai      Provider interface (Anthropic, OpenAI), off unless configured
packages/redact  Optional PII redaction before AI calls
docker           Local Postgres via Docker Compose
```

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose -f docker/docker-compose.yml up -d   # or point DATABASE_URL at your own Postgres
pnpm db:generate && pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Bring your own database

Set `DATABASE_URL` to any Postgres connection string: Supabase, Neon, RDS, or local.

## Bring your own AI key

Leave `AI_PROVIDER` and `AI_API_KEY` blank and the app runs with every AI feature hidden. Set them to turn AI on. `AI_REDACT_PII=true` (default) strips emails, phone numbers, and URLs before text leaves your server.

## Roadmap

1. Foundation (this scaffold)
2. Jobs, careers page, applications, candidate profile
3. Pipeline kanban and scorecards
4. Email, reporting, Greenhouse import
5. AI layer and settings
6. Polish, docs, demo site, launch
