#!/bin/sh
# End-to-end check of the self-hosted stack (deploy/docker-compose.yml), from
# images that are already built or pulled:
#
#   MAVISDRAW_IMAGE=mavisdraw MAVISDRAW_VERSION=latest scripts/selfhost-smoke.sh
#
# Everything goes through the web container, as a browser would: the app and
# its security headers, signing up and staying signed in (a first-party
# cookie over plain http), a project, the live-collaboration socket, a public
# embed, and data surviving a full stop and start.
set -eu
cd "$(dirname "$0")/../deploy"

PORT="${SMOKE_PORT:-18080}"
BASE="http://localhost:$PORT"
export COMPOSE_PROJECT_NAME=mavisdraw-smoke
export MAVISDRAW_IMAGE="${MAVISDRAW_IMAGE:-mavisdraw}"
export MAVISDRAW_VERSION="${MAVISDRAW_VERSION:-latest}"

if [ -f .env ]; then
  echo "deploy/.env exists (a real installation?): not touching it. Run this from a clean checkout." >&2
  exit 1
fi
work=$(mktemp -d)
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker compose logs --tail 80 || true; fi
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f .env
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
ok() { echo "ok - $*"; }

./setup.sh "$BASE" >/dev/null
echo "HTTP_PORT=$PORT" >> .env

up() {
  docker compose up -d --no-build --pull never --wait --wait-timeout 180 api web \
    || fail "the stack didn't become healthy"
}
up
ok "stack up (postgres, migrations, api, web)"

# The app, and its headers
curl -fsS -D "$work/h" -o "$work/index.html" "$BASE/" || fail "GET /"
grep -q '<div id="root"' "$work/index.html" || fail "/ isn't the app"
grep -qi '^x-frame-options: SAMEORIGIN' "$work/h" || fail "/ can be framed by other sites"
grep -qi '^x-content-type-options: nosniff' "$work/h" || fail "/ has no nosniff"
curl -fsS -D "$work/h" -o /dev/null "$BASE/embed.html" || fail "GET /embed.html"
if grep -qi '^x-frame-options' "$work/h"; then fail "the embed viewer can't be framed"; fi
curl -fsS -o /dev/null "$BASE/p/anything/d/deep-link" || fail "deep links don't reach the app"
ok "app, deep links and the embed viewer are served, with security headers"

# Through the proxy to the API
curl -fsS "$BASE/api/ready" >/dev/null || fail "/api/ready through the proxy"
email="smoke-$(date +%s)@example.com"
curl -fsS -c "$work/jar" -D "$work/h" -o "$work/register.json" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"correct-horse-battery\",\"name\":\"Smoke\"}" \
  "$BASE/api/auth/register" || fail "sign up"
token=$(sed -E 's/.*"accessToken":"([^"]+)".*/\1/' "$work/register.json")
[ -n "$token" ] || fail "no access token"
cookie=$(grep -i '^set-cookie: refreshToken=' "$work/h" || true)
[ -n "$cookie" ] || fail "no session cookie"
if printf '%s' "$cookie" | grep -qi 'secure'; then
  fail "the session cookie is Secure on a plain-http address: browsers would drop it"
fi
curl -fsS -b "$work/jar" -X POST -H 'Content-Type: application/json' -d '{}' \
  -o /dev/null "$BASE/api/auth/refresh" || fail "staying signed in (cookie refresh)"
ok "sign up and session refresh through the proxy"

auth="Authorization: Bearer $token"
project=$(curl -fsS -H "$auth" -H 'Content-Type: application/json' -d '{"name":"Smoke Map"}' \
  "$BASE/api/projects" | sed -E 's/.*"project":\{"id":"([^"]+)".*/\1/')
[ -n "$project" ] || fail "create a project"
ok "project created"

# The live-collaboration socket upgrades through the proxy
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "$BASE/collaboration" || true)
[ "$status" = "101" ] || fail "the collaboration socket didn't upgrade (HTTP $status)"
ok "live-collaboration socket upgrades"

# A published embed renders for anyone
embed=$(curl -fsS -H "$auth" -H 'Content-Type: application/json' -d '{}' \
  "$BASE/api/projects/$project/embed" | sed -E 's/.*"token":"([^"]+)".*/\1/')
[ -n "$embed" ] || fail "publish an embed"
curl -fsS -D "$work/h" -o "$work/map.svg" "$BASE/api/embed/$embed/svg" || fail "embed SVG"
grep -qi '^content-type: image/svg+xml' "$work/h" || fail "the embed isn't an SVG"
ok "public embed renders"

# Without email, whoever runs the server makes reset links from the command line
link=$(docker compose exec -T api node apps/server/dist/cli/resetLink.js "$email" | tr -d '\r')
case "$link" in
  "$BASE/reset-password?token="*) ;;
  *) fail "the reset-link command printed: $link" ;;
esac
reset_token=$(printf '%s' "$link" | sed -E 's/.*token=//' | sed 's/%2E/./g')
curl -fsS -o /dev/null -H 'Content-Type: application/json' \
  -d "{\"token\":\"$reset_token\",\"password\":\"new-correct-horse\"}" \
  "$BASE/api/auth/reset-password" || fail "resetting with the command-line link"
curl -fsS -o /dev/null -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"new-correct-horse\"}" \
  "$BASE/api/auth/login" || fail "signing in with the new password"
ok "an admin's reset link (no email) works"

# Data survives a full stop and start (migrations rerun and do nothing)
docker compose down >/dev/null 2>&1
up
curl -fsS -o /dev/null -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"new-correct-horse\"}" \
  "$BASE/api/auth/login" || fail "signing in after a restart"
curl -fsS -H "$auth" "$BASE/api/projects/$project" >/dev/null 2>&1 \
  || curl -fsS -o /dev/null "$BASE/api/embed/$embed/svg" || fail "the project after a restart"
ok "data survives a restart"

echo "self-hosted stack: all checks passed"
