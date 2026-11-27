#!/usr/bin/env bash
# Smoke-test the built Docker images (used by CI, runnable locally).
#
#   scripts/docker-smoke.sh server <image> <database-url> [port]
#       Migrates the database (or, with SMOKE_DB_INIT=1, runs scripts/db-init.sh
#       the way docker-compose does), starts the API in production mode and
#       requires /api/health and /api/ready to answer 200. Then signs up,
#       creates a project and renders its embed SVG, which exercises the
#       database and the compiled workspace packages end to end. The container
#       uses the host network, so the database URL is the one the host uses.
#
#   scripts/docker-smoke.sh web <image> [port]
#       Serves the static app and checks the editor, the embed viewer, their
#       assets and the single-page-app fallback.
#
# Both also check that the image doesn't run as root.
set -euo pipefail

mode=${1:?usage: docker-smoke.sh server|web <image> ...}
image=${2:?image required}
here=$(cd "$(dirname "$0")" && pwd)

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Status code of a request (curl prints 000 when nothing answers)
status() { curl -s -o /dev/null -w '%{http_code}' "$@" || true; }

wait_for() {
  local url=$1
  for _ in $(seq 1 60); do
    [ "$(status "$url")" = 200 ] && return 0
    sleep 1
  done
  return 1
}

# Show a failed container's logs, then remove it
cleanup() {
  if [ "$1" != 0 ]; then
    echo "--- logs of $2" >&2
    docker logs "$2" 2>&1 | tail -80 >&2 || true
  fi
  docker rm -f "$2" >/dev/null 2>&1 || true
}

not_root() {
  local uid
  uid=$(docker run --rm --entrypoint id "$image" -u)
  [ "$uid" != 0 ] || fail "$image runs as root"
  echo "ok: runs as uid $uid"
}

smoke_server() {
  local database_url=${1:?database url required} port=${2:-3001}
  local name="mavisdraw-smoke-$$"
  local base="http://127.0.0.1:$port"
  command -v jq >/dev/null || fail "jq is required"

  not_root
  local packages
  packages=$(docker run --rm --entrypoint sh "$image" -c 'ls node_modules/.pnpm')
  if grep -E '^(tsx|vitest|typescript|vite|drizzle-kit|eslint)@' <<<"$packages"; then
    fail "development dependencies are in the runtime image"
  fi
  echo "ok: no development dependencies"

  if [ "${SMOKE_DB_INIT:-0}" = 1 ]; then
    # Exactly what docker-compose's db-init service does
    local host_port=${database_url##*@}
    host_port=${host_port%%/*}
    docker run --rm --network host \
      -v "$here:/app/scripts:ro" \
      -e DATABASE_URL="$database_url" \
      -e DB_HOST="${host_port%%:*}" -e DB_PORT="${host_port##*:}" -e DB_USER=mavisdraw \
      -e NODE_ENV=development \
      --entrypoint sh "$image" /app/scripts/db-init.sh
  else
    docker run --rm --network host -e DATABASE_URL="$database_url" "$image" \
      node apps/server/dist/db/migrate.js
  fi
  echo "ok: database migrated"

  # Production mode (the image default): real secrets are required
  docker run -d --name "$name" --network host \
    -e DATABASE_URL="$database_url" \
    -e JWT_SECRET="$(openssl rand -hex 32)" \
    -e COOKIE_SECRET="$(openssl rand -hex 32)" \
    -e CORS_ORIGIN=http://localhost:3000 \
    -e HOST=127.0.0.1 -e PORT="$port" \
    "$image" >/dev/null
  trap "cleanup \$? $name" EXIT

  wait_for "$base/api/health" || fail "/api/health never answered 200"
  echo "ok: /api/health"
  [ "$(status "$base/api/ready")" = 200 ] || fail "/api/ready is not 200"
  echo "ok: /api/ready"

  local email token project embed headers
  email="smoke-$(date +%s)-$$@example.com"
  token=$(curl -fsS "$base/api/auth/register" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"correct-horse-battery\",\"name\":\"Smoke\"}" |
    jq -r .accessToken)
  [ -n "$token" ] && [ "$token" != null ] || fail "sign-up failed"
  project=$(curl -fsS "$base/api/projects" -H "Authorization: Bearer $token" \
    -H 'Content-Type: application/json' -d '{"name":"Smoke test"}' | jq -r .project.id)
  embed=$(curl -fsS -X POST "$base/api/projects/$project/embed" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d '{}' |
    jq -r .embed.token)
  headers=$(curl -fsS -D - -o /dev/null "$base/api/embed/$embed/svg")
  grep -qi '^content-type: image/svg+xml' <<<"$headers" || fail "the embed SVG did not render"
  echo "ok: sign-up, project, embed SVG"
}

smoke_web() {
  local port=${1:-3000}
  local name="mavisdraw-smoke-web-$$"
  local base="http://127.0.0.1:$port"
  not_root
  docker run -d --name "$name" -p "127.0.0.1:$port:3000" "$image" >/dev/null
  trap "cleanup \$? $name" EXIT
  wait_for "$base/" || fail "/ never answered 200"

  local index deep embed asset
  index=$(curl -fsS "$base/")
  grep -q 'id="root"' <<<"$index" || fail "/ is not the editor"
  echo "ok: /"
  # A deep link is the app, not a 404
  deep=$(curl -fsS "$base/p/some-project/d/some-diagram")
  grep -q 'id="root"' <<<"$deep" || fail "deep links don't fall back to the app"
  echo "ok: single-page-app fallback"
  embed=$(curl -fsS "$base/embed.html")
  grep -q '/assets/embed-' <<<"$embed" || fail "embed.html is not the embed viewer"
  echo "ok: /embed.html"
  # Every script and stylesheet the two pages reference is served
  for asset in $(printf '%s\n%s\n' "$index" "$embed" | grep -oE '/assets/[^"]+' | sort -u); do
    [ "$(status "$base$asset")" = 200 ] || fail "$asset is missing"
  done
  echo "ok: assets"
}

case "$mode" in
  server) smoke_server "${@:3}" ;;
  web) smoke_web "${@:3}" ;;
  *) fail "unknown mode $mode" ;;
esac
echo "Smoke test passed: $image"
