# Pull request checks

When a map was generated from a GitHub repository, every pull request on that repository can be
checked against it. The MavisDraw GitHub App comments on the PR (one comment, kept up to date as
commits are pushed) with:

- **which components it touches** — each changed file is matched to the component whose folder
  contains it, most specific first, with links into the map;
- **how it changes the architecture** — new or removed packages and apps, new dependencies between
  them, new datastores and services (from `package.json`, workspaces, `docker-compose`, `go.mod`,
  `Cargo.toml`, `pyproject.toml` at the PR's base and head) — and whether the map shows that yet;
- a link to **review the proposed map update**: it waits in the editor's **Proposals** panel for
  someone with edit access to apply (one undoable step) or dismiss. A new push replaces it.

Only file lists and manifests are read, never source code.

## Set up (once per MavisDraw server)

1. Open `https://<your-api-host>/api/github-app/setup` (add `?org=<your-org>` to have the app owned by
   an organization) and click **Create the GitHub App**. GitHub asks you to confirm.
2. The page you return to shows four environment variables — `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
   `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY`. Add them to the API service (on Render: its
   **Environment** tab) and redeploy. They're shown only once.
3. Install the app on the repositories your maps come from (the link is on that page, and in each
   map's **Code** dialog).

The app asks for read access to code and metadata, write access to pull requests (for its comment),
and pull request events. For GitHub Enterprise, also set `GITHUB_APP_WEB_URL` (your server) and
`GITHUB_APP_API_URL` (`https://<server>/api/v3`).

## Which maps are checked

A map's pull requests are checked only when it was linked to the repository by someone who speaks
for both sides: a **project owner or admin whose GitHub connection can push to the repository**.
MavisDraw asks GitHub when the link is saved, records the host, and re-checks at least daily through
the linker's own connection; if they lose push access or their project role, checks turn off for that
map. Anyone else (an editor, or someone who can only read a public repository) can still link a map
for drift checks in the editor, but it never feeds pull-request comments — the **Code** dialog says
so.

Everything the comment shows from a map or a repository (project and component names, diagram
titles, package names) is escaped: it can't add links, images, HTML or @mentions. The comment names
the map's components and links to it; people need MavisDraw access to open it. Maps linked before
these rules existed are picked up again once an owner/admin re-links them (**Code → Check against
the code → Mark map as up to date**).

## Details

- Webhook: `POST /api/github-app/webhook`, verified with `X-Hub-Signature-256`. It answers at once
  and checks in the background (GitHub gives up after 10 seconds); pushes to the same PR are
  checked one at a time, in order.
- Events: `pull_request` — `opened`, `synchronize`, `reopened`, `ready_for_review`.
- Limits: up to 3,000 changed files and 80 manifests per PR.
