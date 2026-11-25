# PennyATS

[![CI](https://github.com/PennyATS/PennyATS/actions/workflows/ci.yml/badge.svg)](https://github.com/PennyATS/PennyATS/actions/workflows/ci.yml)

Open source applicant tracking for founders, founding recruiters, and small teams. Self-host it, bring your own Postgres database, and optionally bring your own AI API key. AI features are off by default.

> Status: milestone 6 of 7. The core hiring loop, pipeline board, scorecards, privacy tools, reports, and opt-in AI features work end to end; polish and launch are next. The UI is intentionally plain until the visual design is settled.

## What works today

- **Sign in and roles.** First-run setup creates the admin. Admins invite teammates, change roles, deactivate accounts, and issue one-time password reset links to copy and send. Interviewers only see jobs they're on the hiring team for.
- **Jobs.** Create and edit jobs as draft, open, or closed. Each job has its own pipeline stages (rename, reorder, add, remove) and hiring team.
- **Careers page.** Open jobs are listed at `/careers` with an apply form and resume upload. Includes basic spam protection.
- **Applications.** Candidates are matched by email, so someone applying to a second role keeps one profile. Recruiters can add candidates by hand, move them between stages, reject with a reason, or mark them withdrawn.
- **Pipeline board.** A kanban view per job. Drag candidates between stages, or use the arrow buttons from the keyboard. Cards show days in stage and scorecard results.
- **Scorecards.** Each job has its own list of attributes, rated 1 to 4, plus an overall recommendation from Strong no to Strong yes. Interviewers can't see anyone else's scorecard until they've submitted their own, so earlier feedback doesn't sway them.
- **Candidate profiles.** Contact details, resume download, every application, scorecards, notes, and an activity timeline. Mark candidates hired, rejected, or withdrawn.
- **Reports.** Filter by job and period to see the hiring funnel, time in each stage, time to hire, which sources produce hires, rejection reasons, and how many scorecards each interviewer has submitted.
- **Optional AI.** Bring your own Anthropic or OpenAI key (or a local model through an OpenAI-compatible server like Ollama) to draft job descriptions and summarize interview feedback. Off unless you add a key, and each feature can be switched off.
- **Privacy tools.** A privacy notice and optional consent checkbox on the apply form, one-click export of everything stored about a candidate, permanent deletion, automatic deletion of rejected candidates after a retention period you choose, and an audit log that records each of these without keeping the deleted person's details.

## Quick start

### Docker Compose

Docker Compose runs Postgres, applies migrations, and starts the production app:

```bash
cp .env.example .env
docker compose -f docker/docker-compose.yml up --build -d
```

Open http://localhost:3000 to create the first admin account. The database and uploaded resumes use persistent Docker volumes. See the [deployment guide](docs/deploy.md) before exposing the app to the internet.

### Local development

Requires Node 22+ and pnpm (`corepack enable` gives you the right version).

```bash
pnpm install
cp .env.example .env
```

Point `DATABASE_URL` in `.env` at any Postgres: a free [Neon](https://neon.tech) or Supabase database, RDS, or local Docker. PennyATS is developed and tested on Postgres 18; versions 14 and newer should work but aren't tested.

If you use the local Docker database, start only that service. Then create the tables and start the app:

```bash
docker compose -f docker/docker-compose.yml up -d db
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000 and you'll be asked to create the first admin account.

### Demo data

To try it with sample data instead, run `pnpm db:seed` after migrating. It adds one job, three made-up candidates, and a demo login: `admin@example.com` / `pennyats-demo`. Only use the seed on a throwaway database.

## Privacy

Admins set this up under **Privacy** in the sidebar:

- **Notice and consent.** Text and a policy link shown on every apply form, with an optional required checkbox. The time of consent is saved on the candidate.
- **Access and deletion requests.** Each candidate profile has *Export all their data* (JSON) and *Delete permanently*, which removes them from every job along with their resume, scorecards, notes, and history.
- **Retention.** Pick a number of months, and rejected or withdrawn candidates with no activity for that long can be deleted from the Privacy page or on a schedule with `pnpm privacy:purge` (for example a daily cron job). Candidates with an active or hired application are never deleted.
- **AI.** When AI is turned on, emails, phone numbers, and links are swapped for placeholders before text leaves your server (an admin can turn this off under **AI**). Names are not detected, so this reduces exposure rather than eliminating it. Feedback summaries don't send the candidate's or interviewers' names at all. For no third-party sharing, point `AI_BASE_URL` at a model you host yourself.

Deleted data still exists in any database or file backups you keep, so expire those on a schedule too. These tools help with GDPR, CCPA, and similar laws, but they aren't legal advice.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Any Postgres connection string. Required. |
| `APP_URL` | Public URL of the app, used in invite links. Use `https://` in production so the login cookie is marked Secure. |
| `STORAGE_DIR` | Where uploaded resumes are saved. Defaults to `apps/web/.data/uploads`. Back it up along with your database. |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | Optional. `anthropic` or `openai`. Leave blank to keep every AI feature hidden. |
| `AI_BASE_URL` | Optional. Use an OpenAI-compatible server instead of the public API, for example a local model through Ollama (`http://localhost:11434/v1`). |
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
docker           Production Dockerfile and Docker Compose
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions. To report a security problem privately, see [SECURITY.md](SECURITY.md).

## Roadmap

Planned work is tracked as [GitHub issues](https://github.com/PennyATS/PennyATS/issues) on the [PennyATS roadmap board](https://github.com/orgs/PennyATS/projects/1), grouped into "Before launch", "Polish and launch", and "Later".

1. Foundation ✓
2. Auth, jobs, careers page, applications, candidate profiles ✓
3. Pipeline kanban and scorecards ✓
4. Privacy and data protection ✓
5. Reporting ✓
6. AI features and settings page ✓
7. Polish, docs, demo site, launch

Later: email, and CSV import from Greenhouse and other applicant tracking systems.

Not planned for now: interview scheduling with calendar sync, offers and e-sign, job board distribution, a Chrome extension, resume parsing, and hosted multi-tenant.
