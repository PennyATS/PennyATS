#!/bin/sh
# Entry point for docker/Dockerfile.platform (#131): check settings, migrate, start the app.
set -eu

fail() {
  echo "PennyATS cannot start: $1" >&2
  exit 1
}

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. Attach a Postgres database."

# AUTH_SECRET encrypts stored calendar tokens and webhook secrets. One-click templates generate
# it; refuse to run with a missing, short, or published example value.
secret="${AUTH_SECRET:-}"
[ "${#secret}" -ge 32 ] || fail "AUTH_SECRET must be a random value of at least 32 characters."
case "$secret" in
  *changeme*|*example*|*pennyats-demo*) fail "AUTH_SECRET looks like an example value. Generate a random one." ;;
esac

# Use the host's generated address when APP_URL is not set.
if [ -z "${APP_URL:-}" ]; then
  if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
    APP_URL="$RENDER_EXTERNAL_URL"
  elif [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    APP_URL="https://$RAILWAY_PUBLIC_DOMAIN"
  else
    fail "APP_URL is not set. Set it to the public https:// address of this app."
  fi
  export APP_URL
fi

# Hosts mount volumes owned by root; give the uploads folder to the app user.
mkdir -p "$STORAGE_DIR"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$STORAGE_DIR"
  run="setpriv --reuid=node --regid=node --init-groups env HOME=/home/node"
else
  run=""
fi

cd /app
$run pnpm db:migrate
exec $run node apps/web/.next/standalone/apps/web/server.js
