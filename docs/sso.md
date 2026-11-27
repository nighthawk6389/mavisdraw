# Single sign-on (OpenID Connect)

People can sign in to MavisDraw with your company's identity provider. Any provider that supports
OpenID Connect works, including Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak,
Authentik and JumpCloud. The sign-in page then shows **Sign in with <name>**, above the email and
password forms, or instead of them.

One provider is set per server. SAML isn't supported yet.

## How it works

- **First sign-in:** the person gets a MavisDraw account. If an account with the same email
  address already exists, that account is linked instead, so existing projects stay theirs. The
  provider vouches for the address, so it counts as confirmed, and pending invites to that address
  are accepted.
- **After that:** the provider's identity for the person is linked to their account (the ID
  token's `iss` and `sub`). Their address can change at the provider and they still reach the same
  account.
- **Coming back:** people return to the page they started from, such as an invite link or a
  project.
- **Security:** the server uses the authorization code flow with PKCE, a one-time `state` and
  `nonce`, and checks the ID token's signature against the provider's published keys. It also
  checks the issuer, audience and expiry. The client secret stays on the server.

## Setting it up

1. At your provider, create an **OpenID Connect web application** (it may be called "confidential
   client" or "regular web app"), with:
   - **Sign-in redirect URI:** `<APP_URL>/api/auth/oidc/callback`, for example
     `https://draw.example.com/api/auth/oidc/callback`;
   - **Grant type:** authorization code;
   - **Scopes:** `openid email profile`.
2. Add these settings to `.env`:

   ```sh
   OIDC_ISSUER=https://acme.okta.com
   OIDC_CLIENT_ID=0oa1b2c3d4
   OIDC_CLIENT_SECRET=…
   OIDC_NAME=Acme SSO                       # the button says "Sign in with Acme SSO"
   OIDC_ALLOWED_DOMAINS=acme.com,acme.co.uk # optional, recommended
   ```

3. Restart: `docker compose up -d`.

### Settings

| Setting | What it does |
| --- | --- |
| `OIDC_ISSUER` | The provider's issuer URL. The server reads `<issuer>/.well-known/openid-configuration` from it. It must be `https` in production. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | From the application you created. All three settings go together. |
| `OIDC_NAME` | The provider's name on the sign-in button. Default: "single sign-on". |
| `OIDC_ALLOWED_DOMAINS` | A comma-separated list. Only addresses at these domains can sign in. Leave it empty to allow anyone the provider signs in. |
| `SSO_ONLY` | `true` turns off email and password sign-in, sign-up and password resets. Everyone signs in through the provider. |
| `OIDC_SCOPES` | Default: `openid email profile`. |
| `OIDC_REDIRECT_URI` | Only needed if the redirect URI must differ from `<the address the API is reached at>/api/auth/oidc/callback`. |

`GET /api/config` shows what the sign-in page offers: `{"sso": {"name": "Acme SSO"},
"passwordLogin": true}`.

### Which addresses are trusted

The first sign-in links to any account with the same address, so use a provider where people
can't choose their own address. That covers your own tenant at Okta, Entra ID, Google Workspace or
Keycloak, where the address comes from your directory. Set `OIDC_ALLOWED_DOMAINS` to your company's
domains as well. A provider that marks an address as unverified (`email_verified: false`) is
refused.

Avoid Entra ID's multi-tenant `common` or `organizations` endpoints, and social login providers
that let anyone register an address. Use your own tenant's issuer instead.

## Providers

**Okta.** Applications → Create App Integration → OIDC, Web Application. Sign-in redirect URI as
above. The issuer is `https://<your-org>.okta.com`, or a custom authorization server such as
`https://<your-org>.okta.com/oauth2/default`. Assign the people or groups who should have access.

**Microsoft Entra ID.** App registrations → New registration, "Accounts in this organizational
directory only". The redirect URI is a **Web** platform with the URI above. Under Certificates &
secrets, add a client secret. The issuer is `https://login.microsoftonline.com/<tenant-id>/v2.0`.
If people's email doesn't come through, add the optional `email` claim to the ID token (Token
configuration).

**Google Workspace.** Google Cloud console → APIs & Services → Credentials → OAuth client ID, "Web
application", with the redirect URI above. Set the consent screen to **Internal** so only your
Workspace accounts can sign in. The issuer is `https://accounts.google.com`. Set
`OIDC_ALLOWED_DOMAINS` to your Workspace domains: the same issuer also signs in personal Gmail
accounts.

**Keycloak.** Clients → Create client, OpenID Connect, with "Client authentication" on. The valid
redirect URI is as above. The issuer is `https://<host>/realms/<realm>`.

**Auth0.** Applications → Create Application → Regular Web Application. Allowed Callback URLs as
above. The issuer is `https://<tenant>.auth0.com`.

## Troubleshooting

When a sign-in doesn't go through, the sign-in page says why, and `docker compose logs api` has the
details (`Single sign-on refused` and a reason).

- **"That sign-in expired or didn't start here":** the sign-in took longer than 10 minutes, or the
  browser didn't keep the cookie set when it left for the provider. Check that `APP_URL` is the
  address in the browser.
- **"Signing in with … didn't work":** often a redirect URI mismatch at the provider, a wrong
  client secret, or an `OIDC_ISSUER` that isn't the issuer the provider's discovery document
  names.
- **"That account isn't allowed to sign in here":** the address isn't at one of the
  `OIDC_ALLOWED_DOMAINS`.
- **"… didn't share a verified email address":** add the `email` scope or claim at the provider.

## Notes

- With passwords still on, someone who signed in through the provider can also set a password with
  "Forgot your password?". `SSO_ONLY=true` prevents that.
- Signing out of MavisDraw doesn't sign out of the provider. Removing someone at the provider stops
  their new sign-ins, but a session they already have lasts until it expires (30 days at most).
