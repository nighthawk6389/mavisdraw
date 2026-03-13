# GitHub OAuth Setup (Development)

This guide explains how to set up and test the "Connect GitHub Account" feature locally.

## Prerequisites

- Node.js 22+, pnpm 10+
- A GitHub account
- The MavisDraw server and web app running locally

## 1. Create a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in:
   - **Application name**: `MavisDraw (dev)` (or anything you like)
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/oauth/github/callback.html`
3. Click **Register application**
4. Copy the **Client ID**
5. Click **Generate a new client secret** and copy it

## 2. Configure Environment Variables

Add the following to your server `.env` file:

```bash
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>
GITHUB_TOKEN_ENCRYPTION_KEY=<64-char-hex-string>
```

Generate the encryption key with:

```bash
openssl rand -hex 32
```

The redirect URI defaults to `http://localhost:3000/oauth/github/callback.html`, so `GITHUB_REDIRECT_URI` is optional for local dev.

## 3. Seed the Database & Start Dev

```bash
pnpm run db:seed    # creates demo@mavisdraw.dev / password123
pnpm run dev        # starts frontend (port 3000) + backend (port 3001)
```

In dev mode, the frontend auto-logs in with the demo account — no manual login needed.

## 4. Test the Flow

1. Open `http://localhost:3000`
2. Click the **GitHub button** in the editor header
3. In the dialog, click **Connect GitHub Account**
4. A popup opens to GitHub's OAuth consent screen
5. Authorize the app — the popup redirects back, relays the auth code to the parent window via `postMessage`, and closes automatically
6. The backend exchanges the code for an access token, encrypts it (AES-256-GCM), and stores it in the `github_connections` table
7. The dialog should now show your connected GitHub username

After connecting, you can link repositories/files to portal elements and browse code via the RepoBrowser.

## How It Works

### Architecture

```
┌─────────────┐    1. GET /api/github/authorize    ┌─────────────┐
│  Frontend    │ ──────────────────────────────────→│  Backend     │
│  (port 3000) │←────────────────────────────────── │  (port 3001) │
│              │    returns GitHub OAuth URL         │              │
│              │                                     │              │
│  2. Opens popup to GitHub OAuth                    │              │
│     ↓                                              │              │
│  3. GitHub redirects popup to                      │              │
│     /oauth/github/callback.html?code=...           │              │
│     ↓                                              │              │
│  4. callback.html postMessages code                │              │
│     back to parent window                          │              │
│     ↓                                              │              │
│  5. Parent sends code via                          │              │
│     POST /api/github/callback  ──────────────────→│  6. Exchanges │
│                                                    │     code for  │
│                                                    │     token,    │
│                                                    │     encrypts, │
│                                                    │     stores    │
└─────────────┘                                     └─────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `apps/server/src/routes/github.ts` | OAuth route handlers (`/authorize`, `/callback`, `/status`) |
| `apps/server/src/services/githubService.ts` | Token exchange, GitHub API calls, connection storage |
| `apps/server/src/utils/encryption.ts` | AES-256-GCM encryption for access tokens |
| `apps/web/public/oauth/github/callback.html` | Static page that relays the OAuth code back to the parent window |
| `apps/web/src/stores/githubStore.ts` | Zustand store managing connections, popup flow, and repo browsing |
| `apps/web/src/components/github/GitHubConnectDialog.tsx` | Connect/disconnect UI |
| `apps/web/src/components/github/RepoBrowser.tsx` | Repository file browser |

### Token Security

- GitHub access tokens are encrypted with **AES-256-GCM** before database storage
- Tokens are decrypted server-side only when needed for API calls
- Tokens never reach the frontend — the API returns only the GitHub username and connection ID
- Each connection uses a unique IV and auth tag

## Troubleshooting

### Popup shows the login screen instead of connecting

The OAuth callback URL must end with `.html` (i.e., `/oauth/github/callback.html`). Without the extension, Vite's SPA fallback serves `index.html` instead of the static callback page, causing the React app to boot in the popup with no auth context.

**Fix**: Ensure both the `GITHUB_REDIRECT_URI` env var (if set) and the GitHub OAuth App's callback URL end with `.html`.

### "Unable to communicate with the main window"

The popup lost its `window.opener` reference. This can happen if the browser blocks popups. Allow popups for `localhost:3000`.

### Token refresh / 401 errors

The backend requires authentication for all GitHub routes. Make sure you're logged in (dev mode auto-login should handle this). Check the browser console for `[auth]` log messages.
