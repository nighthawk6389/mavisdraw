# Backlog

## From the 2026-11 product audit (see `ROADMAP.md` §2–§4 for full context)

### Data integrity (P0)

- ~~REST autosave and Hocuspocus both write `diagrams.elements`~~ — fixed in Phase 3: while a room is live, Y.js owns elements (CRDT state persisted in `diagrams.yjs_state`), REST writes merge into the live doc by version, and snapshot restore goes through the live doc.
- ~~Whole-element `Y.Map` replacement~~ — fixed: per-property writes (`ws/ydocElements.ts`, `src/collab/ydocElements.ts`).
- ~~Version history is IndexedDB-only~~ — fixed: shared server-side versions.
- ~~Undo can revert a teammate's later change to the same property~~ — fixed: undo/redo apply per property and skip any property a collaborator changed since (`stores/history.ts` `applyValues`).

### Security (P0)

- ~~GitHub client secret exfiltration / SSRF via client-supplied `enterpriseUrl`~~ — fixed: hosts are allowlisted (github.com plus one operator-configured Enterprise server, each with its own OAuth app; `resolveGitHubHost`).
- ~~Viewers can write over WebSocket~~ — fixed: viewers connect with `connection.readOnly`, and the editor is read-only for them.
- ~~Production seeds `demo@mavisdraw.dev` / `password123`~~ — fixed: the production build no longer seeds, and `db/seed.ts` refuses to run when `NODE_ENV=production`.
- ~~**No password reset, so an address can't be reclaimed**~~: fixed. "Forgot your password?" emails a one-hour, single-use link. Resetting confirms the address, signs out every session and hands over waiting invites, so the real owner can take back a squatted account. Servers without email make links with `cli/resetLink.js`. Still open: expiring unconfirmed accounts after a few weeks.
- ~~**Share links never expire** and can't be revoked individually~~ — fixed: a link can last a day, a week, a month (the default) or forever, and each one can be revoked from the Share dialog, which says when each expires. Past its expiry a link joins nobody new (410); people who already joined keep access until removed.
- ~~**AI agent:** `browse_code`/`read_file` could read any repo the user's GitHub token can see~~ — fixed: they read only the project's linked repositories (its repo link and its portals' code links, worked out by the server; `services/agentRepos.ts`), on github.com or this server's Enterprise host, with the asking person's own connection. The tools also work now: they used to need a GitHub connection id the model had no way to know.
- ~~OAuth `state` never verified; no env validation and a hard-coded JWT fallback secret; `trustProxy` unset~~ — fixed: `state` is HMAC-signed and bound to user, host and a 10-minute TTL; production refuses to start on missing/weak secrets (`config.ts` `assertValidConfig`); `TRUST_PROXY` is explicit.

### Independent collaboration review (2026-11) — status

Fixed (each with a regression test; two-browser e2e in `apps/web/e2e-real/sync-integrity.spec.ts` and `access.spec.ts`):
- ~~Expired token → silent "Connected" with nothing saved~~ — the socket asks for a fresh token on every (re)connect; an auth rejection drops live status, checks access over REST, refreshes and rejoins with backoff. "Live" now requires authenticated + synced.
- ~~Deleted shapes come back~~ — every delete (including undo-of-create) is a tombstone with a newer version; nothing is written to a fresh doc before its first sync.
- ~~REST saves merge whole elements by edit count~~ — saves carry each element's base version and explicit deletes; an edit applies only if nobody changed the element since, otherwise the client is told and adopts the newer version. Same rules when no room is live (merged through the stored CRDT state). Reads/merges wait for a room that's still loading.
- ~~Unauthenticated memory DoS~~ — 16MB WS message cap, 256KB pre-auth cap, 15s auth timeout.
- ~~Removed members keep editing~~ — permission changes apply to open sockets (revoked: closed with 4403 and sent to the dashboard; downgraded: read-only immediately, UI follows).
- ~~Share link → admin; existing viewer stays viewer on an editor link; public projects 403~~ — fixed.
- ~~Snapshot version race (500); restore backup pruned; auto-snapshots stop after 100 undo steps / snapshot the wrong diagram~~ — fixed.
- ~~Browser Back leaves the project~~ — drill in/out are history entries.
- ~~Diagram list returns every diagram's elements~~ — summaries only.
- ~~Cursor/viewport awareness unthrottled; colour changes on every drill-in~~ — ≤20 updates/s per field; stable colour per user.

Still open:
- ~~**Presence identity is client-asserted**~~ — fixed: the collaboration server notes which signed-in person sent each awareness client (first use owns a client id; only the server or its owner frees it) and tells the room in a stateless message only it can send (`ws/presence.ts`). The app names people, cursors and colours from that, never from a client's own awareness state. A client can still move its own cursor and selection however it likes.
- **Y.Doc growth**: tombstones are kept forever; state is stored base64 and rewritten whole on every persist. Needs tombstone compaction (e.g. drop tombstones older than N days on load, re-encode), binary storage, incremental persistence.
- ~~No migrations~~ — fixed: versioned migrations in `apps/server/drizzle`, applied by `db:migrate` / Render's pre-deploy step; databases created with `db:push` are adopted automatically.
- **Single process assumed**: no Redis extension, so two instances during a deploy overlap can both host a room (last persist wins). Add `@hocuspocus/extension-redis` before scaling out.
- **Version history is per diagram**: restoring a parent doesn't restore its nested levels; no preview before restore.
- **Follow mode doesn't follow across nested diagrams**; there's no project-wide "who's where".
- **Title/background/layers aren't live** (REST only, last writer wins for those fields).
- **Off-screen undo**: undo after drilling into a child can change parent elements you can't see (Figma/tldraw scope or reveal it).

### Architecture model follow-ups (docs/model-layer.md)

- ~~**Proposals and PR checks on component ids**~~: done. Adding a component drawn elsewhere shows the same one; connections to other levels are recorded in the model; PR checks see dependencies known anywhere.
- ~~**Inspector column hides shapes on the right**~~: fixed. When the column narrows the canvas, the view scrolls so the selection stays visible (`components/canvas/keepInView.ts`).
- ~~**Component panel actions are separate undo steps from server renames**~~: fixed. Undo and redo of a label rename the component everywhere, like typing it would; a rename from the panel offers Undo in its toast.
- ~~**Tags have no editor yet**~~: done. Tags appear as chips in the component panel (Enter or a comma adds one, × removes it) and are exported to Structurizr.

### Single sign-on follow-ups (docs/sso.md)

- **SAML 2.0** — only OpenID Connect is supported. Some enterprises (older ADFS, Shibboleth) only offer SAML; it needs XML signature checking (`@node-saml/node-saml`) and an SP metadata endpoint.
- **One provider per server** (`config.oidc`). A hosted, multi-company MavisDraw needs SSO per workspace: provider settings stored per workspace (secret encrypted like GitHub tokens), the provider picked by email domain on the sign-in page, and verified domain ownership before a workspace can claim addresses.
- **No deprovisioning** — removing someone at the provider stops new sign-ins, but their refresh session lasts up to 30 days. SCIM (`/scim/v2/Users`), or at least an admin "sign out everywhere" for an account, would close that. Back-channel logout from the provider isn't handled either.
- **Groups aren't mapped** — the provider's `groups` claim could put people into workspaces or roles on first sign-in instead of waiting for invites.
- **No way to see or unlink a linked identity** in account settings (`user_identities`); an admin has to delete the row.

### Second independent review (2026-11, `308bc3c..730bf7e`) — status

Fixed: C1 (REST autosave reverting teammates' work), H1 (unverified emails receiving invites), H2 (ReDoS in the PR-check manifest parser), H3 (cross-tenant PR-comment injection), M1 (SVG embed rendered per request), M2 (`TRUST_PROXY=true` spoofable), M4 (collaborator emails visible to public viewers), M5 (project move/privatize ignored open sockets), M9 (repo links never re-verified), M11 (signals loaded whole diagrams), L1 (admins granting admin, fixed on the testing branch), L2 (any bot's comment edited), L3 (MCP limit error hidden).

Still open:
- ~~**M3 — outbound email can be abused**~~: fixed (`services/emailLimits.ts`). Invite and @mention emails are capped per sender and per recipient in rolling windows; past a cap only the email is skipped (the inviter gets the link, mentions still notify in the app). Mentions from people who aren't on the project (a public project's viewers) send no email. The caps live in process memory, like the other rate limits.
- ~~**M6 — a version restore with no live room writes old versions and no tombstones**~~: fixed. A restore with no room open now goes through the stored CRDT state, so what the version doesn't have is deleted there and a tab with an older copy can't bring it back (`e2e-real/sync-integrity.spec.ts`).
- ~~**M7 — the non-live REST merge is an unlocked read-modify-write**~~: fixed. Every write from outside a live room (a save, a restore, a rename) goes through `services/diagramContents.ts`: under a per-diagram lock that a room opening meanwhile waits for, and a row lock (`SELECT … FOR UPDATE`). A room that just closed has its pending save run first. Twelve simultaneous saves all land (`e2e-real/diagrams-api.spec.ts`). The lock is per process, like the rest of the live state.
- ~~**M8 — the offline journal is per project, not per user or tab**~~: fixed (`services/offlineJournal.ts`). Each tab keeps its own journal per account and project; a tab opening the project takes over the journals of tabs that are gone (Web Locks, or a BroadcastChannel ping where locks aren't available, e.g. plain-http self-hosts). Signing out asks if there are unsaved edits on the device, then discards that account's journals. Edits for a level that doesn't load are kept until it does. Also fixed on the way: joining a room overwrote a restored edit of an existing shape with the room's older copy (the initial sync now goes through the version-aware merge only).
  - Still open: signing out while offline can't clear the session cookie (the server never gets the logout), so reloading signs the same account back in. A client-side "signed out" marker checked before the silent refresh would close that.
- ~~**M10 — proposal claim/apply gaps**~~: fixed. The editor applies a proposal first (all or nothing: a failure part-way puts the canvas back), only onto a diagram that loaded, then marks it applied with a key, so a retry after a lost answer is "done" rather than "taken". If someone else marked it applied a moment earlier, this editor's copy is undone. Settled proposals can't be reopened (`status: 'pending'` is refused).
- **L4–L13** (from the review report), status:
  - Fixed:
    - **secrets only enforced with `NODE_ENV=production`:** the server image sets it.
    - **`CommentLayer` re-rendered on every drag frame:** it now follows only the shapes pins sit on (`pinPositionsKey`), and pins and threads are memoised.
    - **The embed viewer's retry stacked timers:** each try now replaces the last one's timer and listeners.
    - **The pre-auth WebSocket cap was per socket:** at most 50 sockets per address may wait to authenticate (`ws/preAuthLimit.ts`).
    - **Typeahead capture could swallow keys for 1s:** Enter on something without a label (a freehand stroke, an image) no longer starts it, and it stops if no editor opens within two frames.
    - **Pending invites outlived their inviter's access:** an invite only works while whoever sent it could still send it.
  - Improved: **MCP `find_component` loads up to 25 scenes per call.** Each project's components are reused for 20 s, so searches in a row are cheap. A cold search still loads them all.
  - Still open:
    - ~~**The app is frameable on Render**~~ and ~~**the refresh cookie isn't sent across Render's two sites**~~: fixed. On Render the API now serves the built app on its own address (`WEB_DIST`, `apps/server/src/webApp.ts`), so the cookie is first-party and the app refuses other sites' frames while `/embed.html` stays frameable. See `docs/render.md` for moving an existing two-service deploy.
    - **Per-process state** (single instance only) is by design for now; see Architecture.

### Third independent review (2026-11-27, `edcb5e1..HEAD`, focus `730bf7e..HEAD`) — all fixed

High, fixed (each with an e2e test that fails without the fix):
1. ~~**Any signed-in user could overwrite labels in other people's projects**~~: a rename patched whatever diagram each element *said* it was on. `loadProjectScene` now puts every element on the diagram it was stored in, and renames only patch the project's own diagrams (`e2e-real/authorization.spec.ts`).
2. ~~**Accepting an invite link confirmed the email address**~~, though the inviter has the link too. It still joins that invite's project, but the address is only confirmed by the emailed confirmation or reset link, or SSO (`e2e-real/email-verification.spec.ts`).
3. ~~**SSO linked to an existing unconfirmed account and left the squatter's way in**~~: such an account is now taken back like a reset: password removed, sessions, tokens and agents ended, open sockets closed (`e2e-real/sso.spec.ts`).
4. ~~**A password reset left access tokens and signed-in agents working**~~: a reset ends sessions, personal tokens, signed-in agents, approved-but-uncollected agent sign-ins and open sockets (`services/accountAccess.ts`). Access tokens already issued (15-minute JWTs, checked without the database) are refused too, per process (`services/accessRevocation.ts`): after a restart, ones issued in the 15 minutes before it work until they expire.

Medium and low, fixed (each with a test that fails without the fix where one could be written):
5. ~~SSO accepted a missing `email_verified`~~: the provider has to say `true`, unless the operator sets `OIDC_TRUST_EMAIL=true` (Entra ID leaves the claim out; docs/sso.md).
6. ~~The pre-auth socket cap stopped counting after the first document authenticated~~: data for documents not authenticated on a socket is budgeted per document name (`ws/socketBudget.ts`, `e2e-real/socket-limits.spec.ts`).
7. ~~A nested diagram created offline was lost with its contents~~: the journal keeps diagrams made on the device until the server confirms them, and recreates them (parents first) on the next open.
8. ~~Behind the bundled nginx on `:8080`, sign-in addresses lost the port~~: nginx passes `$http_host`; checked with nginx in front of the API and in the self-host smoke test.
9. ~~Scene reads loaded `yjs_state`, several times per request~~: only a room starting loads the CRDT state; MCP tools reuse the scene they loaded; embeds read contents only when drawing; the component panel refetches the model at most every 2 s.
10. ~~Server reads treated a loading room as empty~~: they use the stored row until the room has loaded (`loadedRoom`).
11. ~~Reset and confirmation emails weren't capped~~: 5 a day per inbox (resets also 30 an hour per client); neither repeats the name someone typed.
12. ~~One diagram failing to save stopped the others~~: each is saved on its own.
13. ~~A transient GitHub error unlinked a map's PR checks~~: only a definite no does; rate limits (403 with no requests left) are told apart from no access.
14. ~~Applying a proposal could undo the wrong step or land on another level~~: it records its own step, refuses if the editor moved to another diagram, and keeps marking it applied in the background if the server couldn't be told.
15. ~~The model never loaded after switching projects mid-fetch~~: fixed in `modelStore`.
16. ~~Authorize errors and Cancel redirected to any registered address~~: errors before consent are shown; Cancel only hands back to an agent on this computer or an app.
17. ~~Unused client registrations were deleted even if once used~~: clients record their last use; only never-used ones go after a day.
18. ~~The journal backup stringified everything before checking its size~~: element sizes are measured once and the backup skipped when too big.
19. ~~SSO couldn't complete on Render's two sites~~: the callback hands a one-time code to the app in the fragment.
20. ~~HTTPS self-hosting also served plain HTTP on every interface~~: `setup.sh` binds it to localhost for https addresses.
21. ~~Model API inputs~~: ids are length-checked, recorded components capped at 5,000 per project, and malformed stored elements (no `boundElements`/`points`) are given a usable shape before modelling or drawing.
22. ~~Layer bitmaps and element counts~~: the bitmaps are freed 5 s after the last frame that used them; the diagram tree's counts are recounted only when something is added, removed or moved between diagrams.

Left as it was: a server-origin write landing during a room's final store could leave a debounce timer on a destroyed document (the reviewer couldn't pin it down; the window is milliseconds).

### Roadmap Phase 3 items not done yet

- ~~Comments & @mentions~~ — done: threads pinned to shapes (pins follow them), replies, resolve/reopen, @mention autocomplete, in-app notifications, a panel across every nested level, `?thread=` deep links, live updates through the room. @mentions are emailed when mail is configured. Still missing: per-user notification settings (email on/off, digests), Slack delivery, comment reactions, and lazy-loading the comments UI (it added ~7 KB gzip to the main bundle).
- ~~Visual diff between versions~~ — done: Compare any version with now (live), added/changed/removed outlined on the canvas, a plain-language change list ("Renamed “Auth” → “Auth Service”"). Still missing: comparing two past versions with each other, and a project-wide diff across nested levels. Auto versions are pruned to the latest 50 per diagram.
- ~~Workspaces, invite by email, folders, transfer ownership~~ — done: workspaces (owner/admin/member; members edit every workspace project), invites by email to projects or workspaces (existing accounts added at once; others get an invite link claimed on sign-up/log-in, valid only for that address), dashboard spaces (Recent / Yours / Shared / each workspace) with folders, and owner → admin handover. Invite emails are sent when a mail provider is configured (Resend/Postmark). Still missing: a separate commenter role (viewers can already comment), SCIM and domain-restricted workspaces (SSO with OpenID Connect is done, see the SSO follow-ups above), workspace-level billing/settings, moving folders between spaces.
- ~~Presentation mode~~ — done: tours (stops = level + view + title + note), "Generate from map" (one stop per level, top-down, described from its contents), full-screen presenting with animated camera moves across levels, and project-wide "X is presenting · Follow" that drives followers through nested levels. Still missing: per-stop highlights/spotlight, multiple named tours, presenter notes hidden from the audience, embedding a tour in docs.
- ~~Offline editing~~ — done: unacknowledged edits are journaled in IndexedDB with their base versions and restored on the next open, unless a teammate changed those elements since (then skipped, and said so); "Offline · N changes kept on this device" indicator. Still missing: opening a project you've never loaded while offline (no local copy of the diagram itself), and service-worker caching of the app shell.
- **Only the diagram on screen is live.** Nested diagrams you're not looking at load over REST (fresh, since REST reads now come from the live room), but you don't see teammates' edits there until you navigate in.

### Roadmap Phase 2 items not done yet

- ~~Repo → map generation, drift detection~~ — done (in the editor): a GitHub repo or local folder becomes a nested map (apps/packages as linked levels, their main folders inside, datastores and external services from manifests and docker-compose); "Check against the code" lists new/removed components and dependencies with one-click fixes. Still missing: import-level analysis inside a component (edges between its folders) and scheduled re-checks.
- ~~PR-time drift~~ — done: a GitHub App (registered from a manifest at `/api/github-app/setup`) checks every pull request on a mapped repository: one comment, kept current, with the components it touches and its architecture changes, plus a proposed map update in the editor. Linking a map to a GitHub repo now requires the linker's connection to be able to read it. See `docs/pr-checks.md`. Since then: a check run on the PR's commit (green when the map is up to date, neutral when behind) and a per-map off switch. Still missing: connection removals in proposals (the proposal format has no "disconnect"), checks for maps linked through portals only (not generated from the repo), and Enterprise app setup from the UI (the setup page assumes github.com).
- ~~Embeds~~ — done: Share → Embed publishes a project read-only (revocable token): an interactive iframe viewer with drill-down (`embed.html`) and a live README SVG (`/api/embed/<token>/svg`, light/dark). See `docs/embeds.md`. Still missing: README images use system fonts (an image can't load the hand-drawn face; a subset could be inlined), embedding a single level only (today the whole project is public once published), view counts, and Notion/Confluence/Backstage plugins.
- ~~**SVG export from the editor doesn't sanitize**~~: fixed. The Export dialog's SVG now comes from the same escaped renderer as embeds (`svgMarkup.ts`); it also no longer writes text twice in hand-drawn mode.
- ~~**The app can be framed on Render**~~: fixed (one service serves the app with per-page headers; `docs/render.md`). The coding-agent consent page still refuses to show inside a frame as well.
- **No Content-Security-Policy beyond `frame-ancestors`** (Render or self-hosted): a script-src policy would limit what an injected script could do. Needs an inventory of what the app loads (Sentry, fonts, data: images) first.
- ~~MCP server~~ — done: `POST /api/mcp` (Streamable HTTP, stateless) with personal access tokens; tools `list_projects`, `read_architecture`, `find_component` (by name or file path), `propose_update` (reviewed and applied in the editor's Proposals panel). See `docs/mcp.md`. Since then: agents sign in through the browser (OAuth 2.1 with PKCE and dynamic client registration, consent page at `/connect-agent`), and tokens and sign-ins can be read-only and limited to chosen maps. Still missing:
  - rate limits per token rather than per IP, and proposals that target several diagrams at once;
  - **browser-based MCP clients** (e.g. MCP Inspector in a tab) can't sign in: the OAuth endpoints only allow the web app's origin (CORS);
  - **Client ID Metadata Documents** (the newer MCP way for an agent to identify itself by URL) aren't supported, only dynamic registration;
  - **a replayed refresh token** is refused but doesn't end the connection it came from (OAuth 2.1 recommends revoking it, as a sign the token was stolen);
  - **registrations** are rate-limited per address and cleared after a day if nobody signed in with them, but a determined client can still add rows.
- ~~**Model + views** (one component shown at several levels)~~ — done: an architecture model under the diagrams (components with details, tags and links; relationships across levels), renames everywhere, a component panel, Structurizr export. See `docs/model-layer.md` and its follow-ups above.
- ~~**Cylinder/queue shapes**~~: done. `cylinder` (datastore) and `queue` element types; Mermaid `[(db)]` imports as a cylinder; draw.io, Excalidraw (as rounded boxes) and Miro (`can`) export them.
- **LLM-markdown paste** — the `packages/llm` format can be exported but pasting it doesn't import with auto-layout yet (Mermaid does).

### Roadmap Phase 1 items not done yet

- ~~Rotation handle~~ — done (handle above the selection, Shift for 15°, rotated frames/resize/bindings/anchors).
- ~~**Eraser, minimap, dark mode**~~ — done. Eraser tool (X: drag across what to remove, Alt to spare, labels and groups go with their shape); overview map (M, bottom right: click or drag to move the view, remembered per browser); dark mode (Shift+Alt+D, ⌘K or the toolbar: follows the system until chosen; the canvas is inverted by a CSS filter, so a dark-mode export still has the light colours). Dark styles come from `apps/web/scripts/make-dark-theme.mjs`: a Tailwind colour class it doesn't list stays light.
- ~~**Architecture shape/icon libraries**~~: done. An icon on any shape (63 Lucide icons, `@mavisdraw/export/library`), and a library of generic blocks and AWS/GCP/Azure/Kubernetes services (`CATALOG`) in the toolbar. Repo maps and proposals pick shape and icon from the catalog by name. Still missing: vendor-styled icons (no logos for trademark reasons), dragging from the library onto the canvas, and user-defined library items.
- ~~**Accessibility pass**~~ — done for the editor: dialogs trap focus, close on Escape and give focus back (`ui/useModalDialog.ts`); the toolbar is one Tab stop with arrow keys; the style, layer and diagram panels are labelled; the canvas is focusable, Tab/Shift+Tab move between shapes, and a live region announces the selection and the tool. Still missing: screen-reader access to a shape's connections (which shapes an arrow joins) and an automated axe check in CI.
- **Images stored inline as base64** — now downscaled to 1600px on insert, but should move to object storage (S3/R2) with references in the element.
- **God objects** — `InteractionManager.ts` / `CanvasRenderer.ts` / `elementsStore.ts` still need splitting (per-tool handlers, one bounds/text-measure module).
- **Touch** — pinch-zoom/pan and single-finger draw work via Pointer Events (coarse pointers get a 6px drag threshold and 12px handle targets), but there's no e2e coverage on a touch device profile.

### Editing interactions — remaining gaps (after the Excalidraw/tldraw/Miro parity pass)

Ranked by user impact; the parity pass itself (smart guides with equal spacing, Shift/Alt modifiers, Alt-drag duplicate, drag threshold, auto-pan, live marquee, rotation, Escape-to-cancel) is in `apps/web/src/components/canvas/gestures/` and `InteractionManager.ts`.

- ~~**Connector points don't snap to guides**~~ — done for endpoints and bend points: they line up with other shapes' edges and centres and with the connector's own other points, with guides (Ctrl/Cmd for free placement). Elbow segments still only snap by binding.
- ~~**A click on a connection dot did nothing**~~ — fixed: it selects the shape (only a drag draws a connector), and the dots answer at the same screen distance at any zoom (it was 10 canvas units: 40px at 400%, 2.5px at 25%).
- ~~**Static layer redraws every frame of a drag**~~: fixed. While only a few shapes change between frames, the shapes below and above them in stacking order are kept as two bitmaps and only the span between is drawn (`canvas/staticLayerPlan.ts`): 0.3ms instead of 4ms a frame dragging among 2,000 shapes, pixel-identical to a full redraw (`e2e/performance.spec.ts`). Any change of view, size, mode or stacking draws everything.
- ~~**StylePanel subscribes to the whole elements Map**~~: fixed. It follows the selection minus its geometry (`selectionStyleKey`), so it no longer re-renders while shapes move.
- ~~**Text resizing doesn't scale the font**~~ — done: free text scales its font from any handle (never stretched or mirrored), alone or in a multi-selection. Rewrapping from a side handle, as Excalidraw does, isn't there yet: text has no fixed wrap width.
- ~~**No lasso selection** and **no Ctrl/Cmd+click deep-select**~~ — done: Alt+drag on empty canvas draws a lasso (what it goes around entirely is selected; Escape restores the selection); Ctrl/Cmd+click picks one shape inside a group.
- ~~**Multi-selections containing rotated shapes** resize them as if unrotated~~ — fixed: such a selection scales uniformly, so turned shapes keep their proportions. Still open: a multi-selection's frame is axis-aligned again after a rotation (Excalidraw keeps the turned frame until deselect), and remote users' selection borders ignore rotation (`renderRemoteSelectionBorder`).
- ~~**Snapping is always on at any speed**~~ — tried and dropped. Skipping snapping while the pointer moved fast made a drop that ended on a quick move (or on a burst of queued events from a busy page) land a few pixels off the line. At that speed a shape crosses a snap zone in under a frame, so there was little stickiness to remove.
- ~~**Toolbar subscribes to whole stores**~~: fixed (one field per selector).
- ~~**Offline journal runs on every element change**~~: improved. The journal, the live room and undo history now share one diff per store update (`diffElementMaps` is memoised, and skips the removal scan when nothing was removed). Per pointer move in a 2,000-shape drag: ~5ms, from ~9–12ms.

### Testing / CI

- The Docker integration suite (`apps/server/src/__tests__/integration`) isn't in CI; the real-backend Playwright lane (`test:e2e:real`) now covers the main flows, but Hocuspocus hooks and WS permissions still have no tests.

---

Items noticed during PR #9 review (arrow improvements) that weren't fixed immediately.

## Observability

- **Keep server-side logging** — All try/catch blocks in `apps/server/src/` must log caught exceptions using `request.log` (in routes/middleware) or `console.error` (in services). Never swallow errors silently. This is critical for debugging production issues.

## Code Quality

- **Duplicate `AnchorPosition` type** — `AnchorPosition` is defined in both `packages/types/src/elements.ts` and `apps/web/src/components/canvas/HitTesting.ts`. Consolidate into `@mavisdraw/types` and import from there.

- **`hoveredAnchor` typed as `string | null`** — Should be `AnchorPosition | null` in `InteractionManager.ts` for type safety.



## Architecture

- **Implicit `as Partial<LinearElement>` casts** throughout when calling `updateElement` with linear-specific fields like `points` or `routingMode`. A type-safe approach would use typed overloads or a generic `updateElement<T extends MavisElement>`.

- **Server build compiles its tests into `dist/`** (`apps/server/tsconfig.json` includes `src/__tests__`), so the Docker images and Render deploy ship `dist/__tests__` (they import vitest, which isn't installed in production). Harmless today since nothing loads them, but a `tsconfig.build.json` excluding `__tests__` (like `packages/llm`) would keep the runtime output clean.

- ~~**The web image's nginx sends no security headers**~~: fixed: `X-Frame-Options`/`frame-ancestors 'self'` on the app (the embed viewer stays frameable), `nosniff` and a referrer policy (`nginx.conf.template`). A full CSP is still to do (see “No Content-Security-Policy beyond `frame-ancestors`”).

- **`createElement` name is misleading** — It only creates and returns an element object with defaults but does not add it to the store. Renaming to `buildElement` or `createElementTemplate` would clarify the contract.

## Testing

- ~~No e2e tests for multi-element resize~~ — covered in `e2e/interactions.spec.ts` (Resizing).
- **Fixed sleeps left in e2e** — the pointer-driven mocked specs still sleep (`e2e/arrow-improvements` 42 `waitForTimeout`s, `zoom-pan` 22, `element-creation` 11, `navigation` 6); they belong with the canvas interaction work. In the real-backend suite, `sync-integrity.spec.ts` and `offline.spec.ts` still sleep 0.6–2.5s to "let autosave run"; they need a condition to wait on (e.g. a test hook exposing the autosave status / pending journal count). For "a write must NOT arrive" checks use `liveBarrier` (`e2e-real/helpers.ts`) instead of sleeping.
- **Store logic without unit tests** — `commentsStore`, `presentStore`, `versionStore`, `githubStore` and `proposalsStore` (optimistic updates, follow/present state, compare) are only covered through e2e. `pnpm --filter @mavisdraw/web run test:coverage` lists them.
- **API-level tests live in the real-backend lane** — `e2e-real/authorization.spec.ts` and `diagrams-api.spec.ts` use no browser; if the unit lane ever gets a Postgres service, they could move to vitest + `app.inject` and run on every push.

## Data integrity (found while testing, not fixed)

- **Deleting a nested diagram orphans its children** (`routes/diagrams.ts` DELETE): `diagrams.parent_diagram_id` has no foreign key, so the children (and their contents) stay in the database with a parent that no longer exists, and the portal that pointed at it is left dangling. The UI never deletes diagrams today (only the API can); decide whether a delete cascades to the subtree or is refused while it has children.
- **Project admins can demote or remove other admins** (`PUT/DELETE /api/permissions/:id`): only the owner may *grant* admin now, but any admin can still take it away from another. Decide the policy (owner-only for admin rows?) and add it to `e2e-real/authorization.spec.ts`.
- **Importing ignores the file's diagram settings** (`ImportHandler.tsx`): the file's top level merges into the diagram on screen, so its background/grid/render mode and layers are dropped; nested diagrams keep theirs.
