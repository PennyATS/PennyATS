# Public demo

PennyATS can run as a public demo: a throwaway instance filled with fictional data that anyone can sign in to and click around, and that wipes itself back to the sample data on a schedule. This page is for whoever hosts that demo. If you want to run PennyATS for your own team, see [deploy.md](deploy.md) instead, and never turn on demo mode there.

## What demo mode changes

Set `DEMO_MODE=true` on the app. Then:

- Every page shows a banner: fictional data, do not enter real names, emails, or resumes, and when it resets.
- The sign-in page lists the demo accounts (`admin@example.com` and `recruiter@example.com`, password `pennyats-demo`). These come from the synthetic seed and are public on purpose.
- Email is never sent. Template emails are recorded as skipped, as if SMTP were not configured.
- AI is off, whatever `AI_PROVIDER` and `AI_API_KEY` say.
- Google Calendar sync is off.
- Webhooks are never delivered, and adding a webhook is blocked, so the demo makes no outbound requests.
- Resume uploads are capped at 512 KB (5 MB normally).
- Rate limits are tighter: 3 public applications per IP an hour (5 normally) and 30 API requests per key a minute (300 normally).
- Inviting users, generating password reset links, and changing roles or deactivating accounts are blocked, so one visitor cannot lock the others out.
- The first-run `/setup` page is disabled, so nobody can claim the demo while it is resetting.

These are the limits in `apps/web/src/lib/demo.ts`.

## Resetting

`pnpm demo:reset` wipes the database (every table), deletes uploaded resumes from `STORAGE_DIR`, runs the migrations, and loads the synthetic seed again. The seed shifts its dates so the data always ends on the day of the reset.

Because it deletes everything, it refuses to run unless all of these hold:

1. `DEMO_MODE=true`.
2. `DEMO_RESET_CONFIRM` equals the database name in `DATABASE_URL` (for example `pennyats`).
3. The database is empty, or it was created by `demo:reset` (it leaves a `demo_instance` marker in the `settings` table). A database with users and no marker is treated as a real deployment and left alone.

Separately, `pnpm db:seed` now refuses to run on a database whose setup was completed through `/setup`, because the seed adds logins with a published password.

## Running it with Docker Compose

On a server used only for the demo:

```
docker compose -f docker/docker-compose.yml -f docker/docker-compose.demo.yml up -d --build
```

This starts Postgres, runs migrations, starts the app with `DEMO_MODE=true`, and adds a `demo-reset` service that resets right away and then every `DEMO_RESET_HOURS` hours (default 6). Put a reverse proxy with HTTPS in front of port 3000 and set `APP_URL` to the public address.

While a reset runs (about a minute), pages may error or show "The demo is resetting". That is expected.

## Checklist before linking it publicly

- The database holds nothing but demo data, and no other app uses it.
- `AI_API_KEY`, `SMTP_*`, and `GOOGLE_CLIENT_*` are unset. Demo mode ignores them, but there is no reason to have paid keys on a public box.
- The banner shows on `/login` and on the careers page.
- `docker compose logs demo-reset` shows "Demo reset complete."

## What CI checks

The "Public demo smoke test" job in `.github/workflows/ci.yml` starts the demo with Docker Compose, checks the banner and demo accounts on `/login`, runs a second reset, and then checks that both `demo:reset` and `db:seed` refuse a database that looks like a real deployment.
