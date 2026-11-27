# Self-hosting MavisDraw

Your architecture maps describe your internal systems. Self-hosting keeps them on your own
infrastructure. Everything runs from one Docker Compose file:

| Container | What it does |
| --- | --- |
| `web` | the app, and the single address people use: `/api` and the live-collaboration socket are passed on to `api` |
| `api` | the API and real-time collaboration server |
| `migrate` | brings the database schema up to date, then exits (before every start of `api`) |
| `postgres` | the database (a Docker volume) |
| `caddy` | optional: HTTPS with automatic certificates |

Requirements: Docker 24+ with Compose v2, 1 CPU and 1 GB of memory for a team, and a domain name
for HTTPS.

## Quick start

```sh
git clone https://github.com/nighthawk6389/mavisdraw.git && cd mavisdraw/deploy
./setup.sh https://draw.example.com     # once: writes .env with fresh secrets
docker compose --profile https up -d    # HTTPS on draw.example.com
```

Without a domain (to try it, or behind a proxy you already run):

```sh
./setup.sh http://<this-server>:8080
docker compose up -d
```

Open the address, create an account and start mapping. Only the `deploy/` folder is needed on the
server; the images are pulled. To build them from the checkout instead, add `--build`.

### Getting the images

The images are published to GitHub's container registry for every release:
`ghcr.io/nighthawk6389/mavisdraw-server` and `ghcr.io/nighthawk6389/mavisdraw-web`, for `amd64` and
`arm64`. While they're private, sign in once with a token that can read packages:

```sh
echo "$TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

The repository owner can make them public under the package's *Package settings → Change
visibility*. Or build them yourself: `docker compose up -d --build`.

## HTTPS

**With the bundled Caddy.** Point the domain's DNS at the server and open ports 80 and 443. In
`.env`, set `APP_URL=https://draw.example.com` and `DOMAIN=draw.example.com` (`./setup.sh
https://…` does both). Then start with `--profile https`. Caddy gets and renews the certificate. Set
`HTTP_PORT=127.0.0.1:8080` so the plain-HTTP port isn't reachable from outside.

**Behind your own proxy** (nginx, Traefik, a load balancer):
- send everything to the `web` container (port 8080 on the host by default);
- keep the `Host` header, and set `X-Forwarded-For` and `X-Forwarded-Proto`;
- allow WebSocket upgrades on `/collaboration`, with a long read timeout (an hour);
- set `TRUST_PROXY=2` in `.env`, so rate limits see each person's address rather than your
  proxy's;
- set `APP_URL` to the `https://` address people open.

## Email

Email carries invites, @mentions and the link that confirms someone's address. Pick one provider in
`.env`:

```sh
MAIL_PROVIDER=smtp
SMTP_URL=smtp://user:password@smtp.example.com:587   # smtps://…:465 for implicit TLS
MAIL_FROM=MavisDraw <mavisdraw@example.com>
```

`resend` (`RESEND_API_KEY`) and `postmark` (`POSTMARK_SERVER_TOKEN`) work too.

**Without email**, MavisDraw still works. Inviting someone shows a link to send them yourself (chat,
your own email). Opening it confirms their address and adds them. Invites only reach accounts that
have confirmed their address, so that nobody can collect invites by signing up with someone else's.

## GitHub

All optional; see `.env.example` for every setting.

- **Sign in to GitHub and map repositories:** an OAuth app with callback URL
  `<APP_URL>/oauth/github/callback.html`, then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
  ([details](github-oauth-setup.md)).
- **GitHub Enterprise Server:** set `GITHUB_ENTERPRISE_URL`, `GITHUB_ENTERPRISE_CLIENT_ID` and
  `GITHUB_ENTERPRISE_CLIENT_SECRET`.
- **Pull-request checks:** open `<APP_URL>/api/github-app/setup` to create the GitHub App, then add
  the four `GITHUB_APP_*` settings it shows ([details](pr-checks.md)).

After changing `.env`: `docker compose up -d` (it recreates what changed).

## Backups

The database holds everything. Back it up regularly:

```sh
docker compose exec -T postgres pg_dump -U mavisdraw mavisdraw | gzip > mavisdraw-$(date +%F).sql.gz
```

To restore into a fresh installation, use the same `.env`:

```sh
docker compose up -d postgres
gunzip -c mavisdraw-2026-11-27.sql.gz | docker compose exec -T postgres psql -U mavisdraw mavisdraw
docker compose up -d
```

Keep a copy of `.env` with the backups:
- `JWT_SECRET` and `COOKIE_SECRET` sign sessions, and changing them signs everyone out;
- `GITHUB_TOKEN_ENCRYPTION_KEY` encrypts the GitHub connections people made.

## Upgrading

```sh
docker compose pull && docker compose up -d
```

`migrate` runs first and brings the database up to date. To control when upgrades happen, pin a
release with `MAVISDRAW_VERSION=1.4.0` in `.env` instead of `latest`. Migrations only go forward,
so back up before upgrading. To go back to an older version, restore that backup.

## Running it

- `docker compose ps` shows health. `api` reports healthy once the database answers
  (`/api/ready`).
- `docker compose logs -f api` gives structured JSON logs. `LOG_LEVEL=debug` adds more.
- With `SENTRY_DSN` set, server errors are reported to Sentry, without personal data.
- Run **one** `api` container. Live rooms, presentations and rate limits are kept in its memory,
  so a second instance would split them.

## Troubleshooting

- **Signed out on every reload:** `APP_URL` doesn't match the address in the browser. An `https://`
  `APP_URL` makes the session cookie HTTPS-only, so opening the plain-HTTP address loses it.
- **"Live" never connects, or edits only save every few seconds:** your proxy doesn't pass
  WebSocket upgrades on `/collaboration`.
- **502 from the app:** `api` isn't up yet, or is failing. Check `docker compose logs api`. The
  server refuses to start with missing or weak secrets and says which.
- **Everyone shares one rate limit:** add 1 to `TRUST_PROXY` for each proxy in front of the `web`
  container.
