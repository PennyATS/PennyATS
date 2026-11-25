# Contributing to PennyATS

Thanks for helping. PennyATS is an open source applicant tracking system for founders and small teams, so the bar is: simple to self-host, easy to understand, and careful with candidate data.

## Before you start

- Planned work lives in [issues](https://github.com/PennyATS/PennyATS/issues) on the [roadmap board](https://github.com/orgs/PennyATS/projects/1). Comment on an issue before starting something big, so work isn't duplicated.
- Security problems: don't open an issue. See [SECURITY.md](SECURITY.md).

## Setup

You need Node 22+ and pnpm (`corepack enable` installs the right version), plus any Postgres database.

```bash
pnpm install
cp .env.example .env        # set DATABASE_URL
pnpm db:migrate
pnpm db:seed                # demo data and login: admin@example.com / pennyats-demo
pnpm dev
```

## Checks to run

Every pull request must pass the same checks CI runs:

```bash
pnpm typecheck
pnpm test
pnpm build
```

If you change something users can see, also try it in the browser and say what you tested in the pull request.

## How the project works

- **Postgres only**, through Drizzle. Change `packages/db/src/schema.ts`, run `pnpm db:generate`, and commit the generated migration.
- **Minimal dependencies.** Prefer a small, typed helper over a new package. Explain any new dependency in the pull request.
- **Every page, server action, and API route checks access itself.** Use `requireUser()` and the role helpers in `apps/web/src/lib/permissions.ts`. Interviewers only see jobs they're on the hiring team for; use the helpers in `lib/hiring.ts` for any query that lists jobs, candidates, or applications.
- **Candidate data.** New tables holding candidate data must be deleted with the candidate (`onDelete: "cascade"`) and included in the data export in `lib/privacy.ts`.
- **AI is optional.** The app must work fully without an AI key. AI features go through `lib/ai.ts`, hide themselves when AI is off, and never send names they don't need.
- **Logic in pure functions** where possible (`lib/*.ts`), with tests next to them (`*.test.ts`, run with Node's built-in test runner).
- **No real candidate data** anywhere: code, tests, screenshots, or issues. Use made-up names and `example.com` addresses.

## Pull requests

- Keep them focused on one change, and reference the issue (`Closes #123`).
- Write commit messages that explain why, not just what.
- User-facing text should be plain and short.
