# Backlog

## From the 2026-11 product audit (see `ROADMAP.md` §2–§4 for full context)

### Data integrity (P0)

- ~~REST autosave and Hocuspocus both write `diagrams.elements`~~ — fixed in Phase 3: while a room is live, Y.js owns elements (CRDT state persisted in `diagrams.yjs_state`), REST writes merge into the live doc by version, and snapshot restore goes through the live doc.
- ~~Whole-element `Y.Map` replacement~~ — fixed: per-property writes (`ws/ydocElements.ts`, `src/collab/ydocElements.ts`).
- ~~Version history is IndexedDB-only~~ — fixed: shared server-side versions.
- **Undo can revert a teammate's later change to the same property.** Local undo is patch-based (remote changes are never recorded, so it never undoes *their* edits), but undoing your own move restores your "before" value even if a teammate moved the same shape afterwards. A per-origin `Y.UndoManager`, or skipping keys whose live value no longer matches the entry's "after", would fix it (`stores/history.ts`, `elementsStore.undo`).

### Security (P0)

- **GitHub client secret exfiltration / SSRF via client-supplied `enterpriseUrl`** (`routes/github.ts:57-67` → `githubService.ts:99-116`).
- ~~Viewers can write over WebSocket~~ — fixed: viewers connect with `connection.readOnly`, and the editor is read-only for them.
- **Production seeds `demo@mavisdraw.dev` / `password123`** (`render.yaml:16`, `db/seed.ts`).
- **Share links never expire** and can't be revoked individually (tokens are now only shown to owners/admins — `routes/sharing.ts`).
- **AI agent:** the diagram now goes in a delimited data message, client system messages are dropped, and turns are rate-limited/size-capped — but `browse_code`/`read_file` can still read any repo the user's GitHub token can see; restrict them to repos linked in the diagram.
- OAuth `state` never verified (`githubService.ts:94`); no env validation and a hard-coded JWT fallback secret (`authService.ts:8`); `trustProxy` unset so IP rate limiting is shared by all users behind the proxy (`app.ts:14`).

### Roadmap Phase 3 items not done yet

- **Comments & @mentions** pinned to elements, resolve threads, notifications — not started (the biggest remaining Teams gap).
- **Visual diff between versions** ("what changed since last week") — versions are full JSON snapshots; there's no diff view yet. Auto versions are pruned to the latest 50 per diagram.
- **Workspaces/orgs, invite by email, commenter role, folders, transfer ownership** — sharing is still per project (owner/admin/editor/viewer + share links).
- **Presentation mode** (guided path through zoom levels) — not started; follow mode exists.
- **Offline editing** — edits made while the room is disconnected are kept locally and REST-saved, then reconciled by version on reconnect; there's no `y-indexeddb` queue, so closing the tab while offline loses unsaved work.
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