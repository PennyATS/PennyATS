# Deploy PennyATS with Docker Compose

From a clean checkout, copy `.env.example` to `.env` and run:

```bash
docker compose -f docker/docker-compose.yml up --build -d
docker compose -f docker/docker-compose.yml ps
```

Compose starts Postgres, runs all migrations, then starts the app. Visit `http://localhost:3000/setup` to create the first admin. Do not run `pnpm db:seed` on a real deployment; it creates a public demo login.

## Configuration

Set these values in the repo-root `.env` file before a public deployment:

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Database user password. The default `pennyats` is for local evaluation only. |
| `COMPOSE_DATABASE_URL` | App and migration connection to the `db` service. Set this when changing `POSTGRES_PASSWORD`; use the same password, percent-encoded for a URL. |
| `APP_URL` | Public HTTPS origin, such as `https://ats.example.com`. Used for links and secure login cookies. |
| `APP_PORT` | Host port for the app, default `3000`. Bound to `127.0.0.1`. |
| `POSTGRES_PORT` | Host port for Postgres, default `5432`. Bound to `127.0.0.1`. |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, `AI_REDACT_PII` | Optional AI settings; leave the key blank to keep AI off. |

`DATABASE_URL` in `.env` is for running database scripts on the host. Compose constructs the container connection from `COMPOSE_DATABASE_URL` (or the default using `POSTGRES_PASSWORD`), where the database hostname is `db`. If the password contains `@`, `:`, `/`, `#`, `%`, or other URL-reserved characters, set `COMPOSE_DATABASE_URL` explicitly and percent-encode only its password portion. Changing the password in `.env` does not change an already initialized Postgres volume; change the database role password inside Postgres first, then update `.env`.

The Docker build excludes `.env` and local uploads. Runtime configuration is passed to containers through Compose. Keep `.env` private and use a secret manager if your deployment platform provides one.

## HTTPS and network access

The app listens on loopback port 3000 on the host. Put a reverse proxy with TLS (for example Caddy or Nginx) in front of `127.0.0.1:3000`, and set `APP_URL` to the exact public `https://` origin. Terminate HTTPS at the proxy and forward requests to the app. Keep Postgres on loopback; do not expose port 5432 publicly.

## Upgrades and migrations

Back up the database and uploads before an upgrade. Pull the new code, then run:

```bash
docker compose -f docker/docker-compose.yml up --build -d
docker compose -f docker/docker-compose.yml ps
```

The one-shot `migrate` service applies pending migrations before the app starts. Migration failure prevents app startup; inspect with `docker compose -f docker/docker-compose.yml logs migrate`. To run it explicitly, use `docker compose -f docker/docker-compose.yml run --rm migrate`. Schedule the privacy retention command separately if you use automatic candidate deletion; it is not part of the app's startup.

## Persistent data and backups

Postgres data is in the `pennyats_pgdata` named volume. Uploaded resumes are in `pennyats_uploads`, mounted at `/app/apps/web/.data/uploads` in the app container (`STORAGE_DIR`). Keep both volumes; `docker compose down -v` deletes them. Back up both as one recovery set, for example:

```bash
docker compose -f docker/docker-compose.yml exec -T db pg_dump -U pennyats -Fc pennyats > pennyats.dump
docker run --rm --volumes-from "$(docker compose -f docker/docker-compose.yml ps -q app)" -v "$PWD":/backup alpine tar -C /app/apps/web/.data/uploads -czf /backup/pennyats-uploads.tar.gz .
```

Run these commands while the app is running, and pause writes during the backup so the database and files describe the same point in time. Store backups encrypted away from the host, test restores, and expire backups according to your data retention policy. Candidate deletion in the app does not remove data from existing backups.
