# Backlog

## From the 2026-11 product audit (see `ROADMAP.md` §2–§4 for full context)

### Data integrity (P0)

- ~~REST autosave and Hocuspocus both write `diagrams.elements`~~ — fixed in Phase 3: while a room is live, Y.js owns elements (CRDT state persisted in `diagrams.yjs_state`), REST writes merge into the live doc by version, and snapshot restore goes through the live doc.
- ~~Whole-element `Y.Map` replacement~~ — fixed: per-property writes (`ws/ydocElements.ts`, `src/collab/ydocElements.ts`).
- ~~Version history is IndexedDB-only~~ — fixed: shared server-side versions.
- ~~Undo can revert a teammate's later change to the same property~~ — fixed: undo/redo apply per property and skip any property a collaborator changed since (`stores/history.ts` `applyValues`).

### Security (P0)

- **GitHub client secret exfiltration / SSRF via client-supplied `enterpriseUrl`** (`routes/github.ts:57-67` → `githubService.ts:99-116`).
- ~~Viewers can write over WebSocket~~ — fixed: viewers connect with `connection.readOnly`, and the editor is read-only for them.
- **Production seeds `demo@mavisdraw.dev` / `password123`** (`render.yaml:16`, `db/seed.ts`).
- **Share links never expire** and can't be revoked individually (tokens are now only shown to owners/admins — `routes/sharing.ts`).
- **AI agent:** the diagram now goes in a delimited data message, client system messages are dropped, and turns are rate-limited/size-capped — but `browse_code`/`read_file` can still read any repo the user's GitHub token can see; restrict them to repos linked in the diagram.
- OAuth `state` never verified (`githubService.ts:94`); no env validation and a hard-coded JWT fallback secret (`authService.ts:8`); `trustProxy` unset so IP rate limiting is shared by all users behind the proxy (`app.ts:14`).

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
- **No migrations** (`db:push` only) — Phase 0 item 0.9.
- **Single process assumed**: no Redis extension, so two instances during a deploy overlap can both host a room (last persist wins). Add `@hocuspocus/extension-redis` before scaling out.
- **Version history is per diagram**: restoring a parent doesn't restore its nested levels; no preview before restore.
- **Follow mode doesn't follow across nested diagrams**; there's no project-wide "who's where".
- **Title/background/layers aren't live** (REST only, last writer wins for those fields).
- **Off-screen undo**: undo after drilling into a child can change parent elements you can't see (Figma/tldraw scope or reveal it).

### Roadmap Phase 3 items not done yet

- ~~Comments & @mentions~~ — done: threads pinned to shapes (pins follow them), replies, resolve/reopen, @mention autocomplete, in-app notifications, a panel across every nested level, `?thread=` deep links, live updates through the room. Still missing: email/Slack delivery of notifications, comment reactions, and lazy-loading the comments UI (it added ~7 KB gzip to the main bundle).
- ~~Visual diff between versions~~ — done: Compare any version with now (live), added/changed/removed outlined on the canvas, a plain-language change list ("Renamed “Auth” → “Auth Service”"). Still missing: comparing two past versions with each other, and a project-wide diff across nested levels. Auto versions are pruned to the latest 50 per diagram.
- **Workspaces/orgs, invite by email, commenter role, folders, transfer ownership** — sharing is still per project (owner/admin/editor/viewer + share links).
- ~~Presentation mode~~ — done: tours (stops = level + view + title + note), "Generate from map" (one stop per level, top-down, described from its contents), full-screen presenting with animated camera moves across levels, and project-wide "X is presenting · Follow" that drives followers through nested levels. Still missing: per-stop highlights/spotlight, multiple named tours, presenter notes hidden from the audience, embedding a tour in docs.
- ~~Offline editing~~ — done: unacknowledged edits are journaled in IndexedDB with their base versions and restored on the next open, unless a teammate changed those elements since (then skipped, and said so); "Offline · N changes kept on this device" indicator. Still missing: opening a project you've never loaded while offline (no local copy of the diagram itself), and service-worker caching of the app shell.
- **Only the diagram on screen is live.** Nested diagrams you're not looking at load over REST (fresh, since REST reads now come from the live room), but you don't see teammates' edits there until you navigate in.

### Roadmap Phase 2 items not done yet

- **Repo → map generation, drift detection (GitHub App + PR comments), MCP server, embeds** — not started; Mermaid import and the AI agent are the current entry points.
- **Model + views** (one component shown at several levels) — not started; still the key data-model decision before the hierarchy grows.
- **Cylinder/queue shapes** — Mermaid `[(db)]` maps to a rounded rectangle for now.
- **LLM-markdown paste** — the `packages/llm` format can be exported but pasting it doesn't import with auto-layout yet (Mermaid does).

### Roadmap Phase 1 items not done yet

- **Rotation handle, eraser, minimap, dark mode** — still missing from the editor.
- **Architecture shape/icon libraries** (AWS/GCP/K8s stencils) — not started.
- **Accessibility pass** — the new context menu and zoom controls have ARIA roles/labels and keyboard support; the toolbar and side panels still don't.
- **Images stored inline as base64** — now downscaled to 1600px on insert, but should move to object storage (S3/R2) with references in the element.
- **God objects** — `InteractionManager.ts` / `CanvasRenderer.ts` / `elementsStore.ts` still need splitting (per-tool handlers, one bounds/text-measure module).
- **Touch** — pinch-zoom/pan and single-finger draw work via Pointer Events, but there's no e2e coverage on a touch device profile.

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

- **`createElement` name is misleading** — It only creates and returns an element object with defaults but does not add it to the store. Renaming to `buildElement` or `createElementTemplate` would clarify the contract.

## Testing

- **No e2e tests for multi-element resize** — `performResize` was rewritten in Phase 1 (proportional scaling, aspect lock); add e2e coverage for resizing multiple selected elements.