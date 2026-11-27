#!/bin/sh
# Entry point for the app stage of docker/Dockerfile (#140): check settings, then start the server.
set -eu

fail() {
  echo "PennyATS cannot start: $1" >&2
  exit 1
}

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set."

# AUTH_SECRET encrypts stored calendar tokens, webhook signing secrets, and scheduling mail
# settings. Refuse a missing, short, or published example value instead of failing later.
secret="${AUTH_SECRET:-}"
[ -n "$secret" ] || fail "AUTH_SECRET is not set. Generate one with: openssl rand -base64 32 (then add AUTH_SECRET=... to .env)."
[ "${#secret}" -ge 32 ] || fail "AUTH_SECRET must be a random value of at least 32 characters. Generate one with: openssl rand -base64 32"
case "$secret" in
  *changeme*|*example*|*pennyats-demo*) fail "AUTH_SECRET looks like an example value. Generate a random one with: openssl rand -base64 32" ;;
esac

exec node apps/web/server.js
