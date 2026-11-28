#!/bin/sh
# Writes .env for a self-hosted MavisDraw, with fresh random secrets.
#
#   ./setup.sh                              # http://localhost:8080
#   ./setup.sh https://draw.example.com     # your domain (use the https profile)
#
# Run it once: it never overwrites an existing .env (that would lock you out
# of your database and sign everyone out).
set -eu
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo ".env already exists: leaving it as it is. Delete it first to start over." >&2
  exit 1
fi

url="${1:-http://localhost:8080}"
url="${url%/}"
case "$url" in
  http://* | https://*) ;;
  *)
    echo "Give the address people will open, with http:// or https:// (got: $url)" >&2
    exit 1
    ;;
esac

# Random hex: openssl when present, the kernel's generator otherwise
rand() {
  openssl rand -hex "$1" 2>/dev/null || od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'
}

domain=""
http_port=""
case "$url" in
  https://*)
    domain=$(printf '%s' "$url" | sed -E 's#^https://([^/:]+).*#\1#')
    # Caddy serves HTTPS on 80/443; the plain-HTTP app port stays on this machine
    http_port="127.0.0.1:8080"
    ;;
esac

port_setting=""
if [ -n "$http_port" ]; then
  port_setting="# Behind Caddy, the plain-HTTP port of the app answers only on this machine
HTTP_PORT=$http_port"
fi

umask 077
cat > .env <<ENV
# MavisDraw settings, written by setup.sh on $(date -u +%Y-%m-%d).
# Keep this file private: it holds the database password and signing keys.
# More settings (email, GitHub, error reporting): see .env.example.

# The address people open
APP_URL=$url
# For HTTPS with the bundled Caddy (docker compose --profile https up -d)
DOMAIN=$domain
$port_setting

POSTGRES_PASSWORD=$(rand 24)
JWT_SECRET=$(rand 32)
COOKIE_SECRET=$(rand 32)
GITHUB_TOKEN_ENCRYPTION_KEY=$(rand 32)

# Email (invites, @mentions, confirming addresses). Without it, share invite
# links by hand. With an SMTP relay:
#   MAIL_PROVIDER=smtp
#   SMTP_URL=smtp://user:password@smtp.example.com:587
#   MAIL_FROM=MavisDraw <mavisdraw@example.com>
MAIL_PROVIDER=none
ENV

echo "Wrote $(pwd)/.env for $url"
if [ -n "$domain" ]; then
  echo "Start it with HTTPS:   docker compose --profile https up -d"
else
  echo "Start it:              docker compose up -d"
fi
