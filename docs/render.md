# Deploying on Render

`render.yaml` deploys MavisDraw as one web service (`mavisdraw-api`) and a Postgres database
(`mavisdraw-db`). The service builds the web app and serves it, together with the API and the live
collaboration socket, on its own address. The self-hosted image does the same with nginx in front.

## Why one address

The app used to be a separate static site (`mavisdraw-web.onrender.com`) calling the API on another
address (`mavisdraw-api.onrender.com`). Every `onrender.com` subdomain is its own site to a browser,
which caused two problems:

- **Sign-in didn't survive a reload.** The session cookie (`SameSite=Lax`) belongs to the API's
  address, and browsers don't send it with requests from another site. Marking it `SameSite=None`
  would let other sites trigger sign-out and session refresh, and Safari blocks such cookies
  anyway.
- **Other sites could frame the app.** A static site's header rules apply to every path, so
  refusing frames would have blocked the embed viewer (`/embed.html`) too.

Served by the API, the cookie is first-party, and each page gets its own headers:

| Path | Headers |
| --- | --- |
| The app's pages (`/`, `/p/…`, `/invite/…`, `/oauth/github/callback.html`) | `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy: frame-ancestors 'self'`, `Cache-Control: no-cache` |
| `/embed.html` | frameable by any site, `Cache-Control: no-cache` |
| `/assets/…` (hashed file names) | `Cache-Control: public, max-age=31536000, immutable` |

Every file is also sent with `X-Content-Type-Options: nosniff` and a referrer policy. Text files are
gzipped when the browser accepts gzip, and `/api`, `/collaboration` and `/.well-known` answer as
before. A missing build file is a plain 404, so a tab left open from before a deploy fails cleanly
instead of loading the app's HTML as a script.

## Settings

| Variable | |
| --- | --- |
| `WEB_DIST` | The built app (`apps/web/dist`). Set by the blueprint; without it the server serves only the API. |
| `APP_URL` | Where people open the app (links in emails, sign-in addresses). Defaults to the service's Render address (`RENDER_EXTERNAL_URL`); set it when you add your own domain. |
| `CORS_ORIGIN` | Not needed. If set, it names another site that may call the API, not where the app is. |

The app is built with empty `VITE_API_URL` and `VITE_WS_URL`, so it calls the API and opens the live
socket on whatever address it was loaded from. `VITE_SENTRY_DSN` is read when the app is built:
deploy again after setting it.

## Moving from the two-service blueprint

Render doesn't delete a service that's removed from a blueprint, so the old static site keeps
running, unmanaged, until you delete it. You can move over at your own pace:

1. **Sync the blueprint** (or merge, with auto-sync on). `mavisdraw-api` rebuilds with the app
   included, so the app is now at `https://mavisdraw-api.onrender.com` (or your custom domain). The
   API keeps its address: MCP connections, README images, GitHub webhooks and the single sign-on
   callback (`/api/auth/oidc/callback`) are unaffected.
2. **`APP_URL`**: if you set it to the static site's address, change it to the new one, or remove
   it to use Render's. Links in invites, mentions and confirmation emails follow it.
3. **GitHub sign-in**: in the GitHub OAuth app, change the callback URL to
   `https://<new address>/oauth/github/callback.html`, and `GITHUB_REDIRECT_URI` too if you set it.
4. **Tell people the new address.** They sign in once there: browsers keep sessions per address.
   Edits made offline in the old address are saved the next time it's open and online, so have
   people open it once before you delete it.
5. **Embeds**: iframes pointing at the old site's `/embed.html` keep working while it runs. New
   embed codes use the new address.
6. **Delete the old static site** once nothing points at it, then remove `CORS_ORIGIN` from
   `mavisdraw-api` if it's still set. To keep old links working instead, give the static site a
   single redirect rule from `/*` to `https://<new address>/*`. Render allows a full URL as a
   redirect's destination; check that the path carries over before relying on it.
