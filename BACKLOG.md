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
- **No password reset, so an address can't be reclaimed** (`routes/auth.ts`). Since email confirmation (review H1), registering someone else's address no longer gets its invites. But the real owner still can't sign up ("Email already registered") or take the account over. A reset-by-email flow would fix both: it confirms ownership, and an unconfirmed account's password could be replaced. Also worth doing: expire unconfirmed accounts after a few weeks.
- **Share links never expire** and can't be revoked individually (tokens are now only shown to owners/admins — `routes/sharing.ts`).
- **AI agent:** the diagram now goes in a delimited data message, client system messages are dropped, and turns are rate-limited/size-capped — but `browse_code`/`read_file` can still read any repo the user's GitHub token can see; restrict them to repos linked in the diagram.
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
- **Presence identity is client-asserted** (awareness `user.id`/`name`): someone can show up as someone else in the avatar list. Fix: stamp identity server-side (e.g. relay presence through a server-validated stateless channel).
- **Y.Doc growth**: tombstones are kept forever; state is stored base64 and rewritten whole on every persist. Needs tombstone compaction (e.g. drop tombstones older than N days on load, re-encode), binary storage, incremental persistence.
- ~~No migrations~~ — fixed: versioned migrations in `apps/server/drizzle`, applied by `db:migrate` / Render's pre-deploy step; databases created with `db:push` are adopted automatically.
- **Single process assumed**: no Redis extension, so two instances during a deploy overlap can both host a room (last persist wins). Add `@hocuspocus/extension-redis` before scaling out.
- **Version history is per diagram**: restoring a parent doesn't restore its nested levels; no preview before restore.
- **Follow mode doesn't follow across nested diagrams**; there's no project-wide "who's where".
- **Title/background/layers aren't live** (REST only, last writer wins for those fields).
- **Off-screen undo**: undo after drilling into a child can change parent elements you can't see (Figma/tldraw scope or reveal it).

### Second independent review (2026-11, `308bc3c..730bf7e`) — status

Fixed: C1 (REST autosave reverting teammates' work), H1 (unverified emails receiving invites), H2 (ReDoS in the PR-check manifest parser), H3 (cross-tenant PR-comment injection), M1 (SVG embed rendered per request), M2 (`TRUST_PROXY=true` spoofable), M4 (collaborator emails visible to public viewers), M5 (project move/privatize ignored open sockets), M9 (repo links never re-verified), M11 (signals loaded whole diagrams), L1 (admins granting admin, fixed on the testing branch), L2 (any bot's comment edited), L3 (MCP limit error hidden).

Still open:
- **M3 — outbound email can be abused** (`services/commentService.ts` `emailMentions`, `services/workspaceService.ts` `inviteByEmail`): anyone signed in can @mention the members of a public project, or invite arbitrary addresses, as often as they like, with their own text in the email. Needs per-user and per-recipient limits, and no mention emails from non-members.
- **M6 — a version restore with no live room writes old versions and no tombstones** (`routes/diagrams.ts` restore): a stale tab joining later reverts it. Restore through the stored CRDT state, like the live path (`replaceElements`).
- **M7 — the non-live REST merge is an unlocked read-modify-write** (`routes/diagrams.ts`): two concurrent saves both merge into the old state, and the second silently drops the first. Needs `SELECT … FOR UPDATE` in a transaction, plus a per-diagram lock that `onLoadDocument` honours. The model API's rename of non-live diagrams (`services/modelService.ts` `patchDiagramElements`) has the same race.
- **M8 — the offline journal is per project, not per user or tab** (`services/offlineJournal.ts`):
  - it survives logout, so the next account on a shared browser restores the previous one's edits;
  - two tabs overwrite each other's journal;
  - a nested diagram that fails to load on reopen has its edits dropped as "conflicts".
- **M10 — proposal claim/apply gaps** (`stores/proposalsStore.ts`, `services/proposalService.ts`):
  - a lost claim response loses the proposal;
  - a partial apply followed by a reopen duplicates components;
  - any editor can reopen any applied proposal;
  - apply runs on a diagram that failed to load.
- **L4–L13** (see the review report): the app is frameable; secrets are only enforced when `NODE_ENV=production` (the server Dockerfile doesn't set it); the refresh cookie is `SameSite=Lax` across Render's two sites; `CommentLayer` re-renders on every drag frame; the embed viewer's retry stacks timers; per-process state (single instance only); the pre-auth WebSocket cap is per socket; typeahead capture can swallow keys for 1s; pending invites outlive their inviter's access; MCP `find_component` loads up to 25 scenes per call.

### Roadmap Phase 3 items not done yet

- ~~Comments & @mentions~~ — done: threads pinned to shapes (pins follow them), replies, resolve/reopen, @mention autocomplete, in-app notifications, a panel across every nested level, `?thread=` deep links, live updates through the room. @mentions are emailed when mail is configured. Still missing: per-user notification settings (email on/off, digests), Slack delivery, comment reactions, and lazy-loading the comments UI (it added ~7 KB gzip to the main bundle).
- ~~Visual diff between versions~~ — done: Compare any version with now (live), added/changed/removed outlined on the canvas, a plain-language change list ("Renamed “Auth” → “Auth Service”"). Still missing: comparing two past versions with each other, and a project-wide diff across nested levels. Auto versions are pruned to the latest 50 per diagram.
- ~~Workspaces, invite by email, folders, transfer ownership~~ — done: workspaces (owner/admin/member; members edit every workspace project), invites by email to projects or workspaces (existing accounts added at once; others get an invite link claimed on sign-up/log-in, valid only for that address), dashboard spaces (Recent / Yours / Shared / each workspace) with folders, and owner → admin handover. Invite emails are sent when a mail provider is configured (Resend/Postmark). Still missing: a separate commenter role (viewers can already comment), SSO/SCIM and domain-restricted workspaces, workspace-level billing/settings, moving folders between spaces.
- ~~Presentation mode~~ — done: tours (stops = level + view + title + note), "Generate from map" (one stop per level, top-down, described from its contents), full-screen presenting with animated camera moves across levels, and project-wide "X is presenting · Follow" that drives followers through nested levels. Still missing: per-stop highlights/spotlight, multiple named tours, presenter notes hidden from the audience, embedding a tour in docs.
- ~~Offline editing~~ — done: unacknowledged edits are journaled in IndexedDB with their base versions and restored on the next open, unless a teammate changed those elements since (then skipped, and said so); "Offline · N changes kept on this device" indicator. Still missing: opening a project you've never loaded while offline (no local copy of the diagram itself), and service-worker caching of the app shell.
- **Only the diagram on screen is live.** Nested diagrams you're not looking at load over REST (fresh, since REST reads now come from the live room), but you don't see teammates' edits there until you navigate in.

### Roadmap Phase 2 items not done yet

- ~~Repo → map generation, drift detection~~ — done (in the editor): a GitHub repo or local folder becomes a nested map (apps/packages as linked levels, their main folders inside, datastores and external services from manifests and docker-compose); "Check against the code" lists new/removed components and dependencies with one-click fixes. Still missing: import-level analysis inside a component (edges between its folders) and scheduled re-checks.
- ~~PR-time drift~~ — done: a GitHub App (registered from a manifest at `/api/github-app/setup`) checks every pull request on a mapped repository: one comment, kept current, with the components it touches and its architecture changes, plus a proposed map update in the editor. Linking a map to a GitHub repo now requires the linker's connection to be able to read it. See `docs/pr-checks.md`. Still missing: a GitHub check run (status) besides the comment, per-project opt-out, connection removals in proposals (the proposal format has no "disconnect"), checks for maps linked through portals only (not generated from the repo), and Enterprise app setup from the UI (the setup page assumes github.com).
- ~~Embeds~~ — done: Share → Embed publishes a project read-only (revocable token): an interactive iframe viewer with drill-down (`embed.html`) and a live README SVG (`/api/embed/<token>/svg`, light/dark). See `docs/embeds.md`. Still missing: README images use system fonts (an image can't load the hand-drawn face; a subset could be inlined), embedding a single level only (today the whole project is public once published), view counts, and Notion/Confluence/Backstage plugins.
- **SVG export from the editor doesn't sanitize** (`packages/export/src/svg.ts`): colors and font names are written into attributes unescaped. The new `renderSvgMarkup` (`svgMarkup.ts`) does it safely; switch the Export dialog's SVG to it (it needs sketchy text parity first).
- **The app can be framed by any site** (no `X-Frame-Options`/`frame-ancestors`): add them for everything except `/embed.html` (Render static headers apply per path, so the embed page needs its own rule).
- ~~MCP server~~ — done: `POST /api/mcp` (Streamable HTTP, stateless) with personal access tokens; tools `list_projects`, `read_architecture`, `find_component` (by name or file path), `propose_update` (reviewed and applied in the editor's Proposals panel). See `docs/mcp.md`. Still missing: OAuth for MCP clients instead of pasted tokens, read-only / per-project token scopes, rate limits per token rather than per IP, and proposals that target several diagrams at once.
- **Model + views** (one component shown at several levels) — not started; still the key data-model decision before the hierarchy grows.
- **Cylinder/queue shapes** — Mermaid `[(db)]` maps to a rounded rectangle for now.
- **LLM-markdown paste** — the `packages/llm` format can be exported but pasting it doesn't import with auto-layout yet (Mermaid does).

### Roadmap Phase 1 items not done yet

- ~~Rotation handle~~ — done (handle above the selection, Shift for 15°, rotated frames/resize/bindings/anchors). **Eraser, minimap, dark mode** — still missing from the editor.
- **Architecture shape/icon libraries** (AWS/GCP/K8s stencils) — not started.
- **Accessibility pass** — the new context menu and zoom controls have ARIA roles/labels and keyboard support; the toolbar and side panels still don't.
- **Images stored inline as base64** — now downscaled to 1600px on insert, but should move to object storage (S3/R2) with references in the element.
- **God objects** — `InteractionManager.ts` / `CanvasRenderer.ts` / `elementsStore.ts` still need splitting (per-tool handlers, one bounds/text-measure module).
- **Touch** — pinch-zoom/pan and single-finger draw work via Pointer Events (coarse pointers get a 6px drag threshold and 12px handle targets), but there's no e2e coverage on a touch device profile.

### Editing interactions — remaining gaps (after the Excalidraw/tldraw/Miro parity pass)

Ranked by user impact; the parity pass itself (smart guides with equal spacing, Shift/Alt modifiers, Alt-drag duplicate, drag threshold, auto-pan, live marquee, rotation, Escape-to-cancel) is in `apps/web/src/components/canvas/gestures/` and `InteractionManager.ts`.

- **Connector points don't snap to guides** — dragging an arrow endpoint, waypoint or elbow segment only snaps by binding to shapes; Excalidraw/tldraw also align points with other shapes' edges/centres. `InteractionManager.ts` (rebinding/waypoint modes) can reuse `snapValues`.
- **Static layer redraws every frame of a drag** — with ~2,000 shapes on screen that's most of the remaining per-move cost (~3ms dev build). Cache the non-moving elements as a bitmap for the gesture and draw only elements whose object changed since it started on the overlay (`CanvasRenderer.ts` render loop).
- **StylePanel subscribes to the whole elements Map** (`components/toolbar/StylePanel.tsx`) — it re-renders on every move while the dragged shape is selected (~0.8ms/move in dev). Select only the style-relevant fields of the selection.
- **Text resizing doesn't scale the font** — Excalidraw scales the font from corner handles and rewraps from side handles; MavisDraw stretches the box only.
- **No lasso selection** (Excalidraw: Alt while box-selecting; tldraw: lasso tool) and **no Ctrl/Cmd+click deep-select** into groups (double-click to enter a group works).
- **Multi-selections containing rotated shapes** resize them as if unrotated; a multi-selection's frame is axis-aligned again after a rotation (Excalidraw keeps the turned frame until deselect). Remote users' selection borders ignore rotation (`renderRemoteSelectionBorder`).
- **Snapping is always on at any speed** — tldraw skips snapping while the pointer moves fast, which feels less sticky; worth trying once there's a way to test it.
- **Toolbar subscribes to whole stores** (`Toolbar.tsx` destructures `useToolStore()` / `useUIStore()`), so any UI-store change re-renders every tool button.
- **Offline journal runs on every element change** (`services/offlineJournal.ts` subscriber, ~0.25ms per move in a 2,000-shape drag).

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

- **The web image's nginx sends no security headers** (`nginx.conf`): no `X-Frame-Options`/`frame-ancestors` (except for `/embed.html`), `X-Content-Type-Options` or CSP — the same gap as the Render static site noted above.

- **`createElement` name is misleading** — It only creates and returns an element object with defaults but does not add it to the store. Renaming to `buildElement` or `createElementTemplate` would clarify the contract.

## Testing

- ~~No e2e tests for multi-element resize~~ — covered in `e2e/interactions.spec.ts` (Resizing).