# Backlog

## From the 2026-11 product audit (see `ROADMAP.md` §2–§4 for full context)

### Data integrity (P0)

- **Child diagrams are never persisted** — `apiCreateDiagram` (`apps/web/src/services/api.ts:224`) has no call sites; `diagramStore.createDiagram` only creates a client-side ID. Autosave of a child `PUT`s a non-existent diagram (404), Hocuspocus rejects the room (`apps/server/src/ws/hocuspocus.ts:19`), and child elements are never fetched (`apiGetDiagram` only for the root in `App.tsx:225`). Nested content is lost on reload.
- **REST autosave and Hocuspocus both write `diagrams.elements`** — last writer wins between collaborators (`useAutoSave.ts:52`, `hocuspocus.ts:88`). Snapshot restore (`routes/diagrams.ts:272`) never reaches the live Y.Doc.
- **Whole-element `Y.Map` replacement on every change** (`collaborationStore.ts:255-261`) — concurrent edits to different properties of one element don't merge; doc bloat. Remote deletes hard-delete while local deletes are soft (`collaborationStore.ts:224-229`).
- **Version history is IndexedDB-only** (`utils/versionDb.ts`) — not shared with collaborators or across devices.

### Security (P0)

- **GitHub client secret exfiltration / SSRF via client-supplied `enterpriseUrl`** (`routes/github.ts:57-67` → `githubService.ts:99-116`).
- **Viewers can write over WebSocket** — no `connection.readOnly` for viewers; access only checked at connect (`ws/hocuspocus.ts:9-35`).
- **Production seeds `demo@mavisdraw.dev` / `password123`** (`render.yaml:16`, `db/seed.ts`).
- **Share tokens returned to every collaborator** (`routes/sharing.ts:62-77`); links never expire.
- **AI agent:** client-supplied diagram markdown interpolated into the system prompt and client system messages accepted (`agentService.ts:15-20`, `routes/agent.ts:8-9`); no quotas/limits on `/api/agent/chat`.
- OAuth `state` never verified (`githubService.ts:94`); no env validation and a hard-coded JWT fallback secret (`authService.ts:8`); `trustProxy` unset so IP rate limiting is shared by all users behind the proxy (`app.ts:14`).

### Broken features

- **Share links lead nowhere** — `ShareDialog` builds `/share/:token` but there is no router and `apiJoinViaShareLink` (`api.ts:275`) is never called.
- **AI chat likely fails at runtime** — UI messages aren't passed through `convertToModelMessages`, and `reply.raw.writeHead` bypasses CORS headers (`routes/agent.ts:22,33`).
- **AI proposals overlap existing content** — fixed grid placement at (100,100) (`ProposalCard.tsx:74-81`); needs auto-layout.
- **No graceful shutdown** — Hocuspocus debounced writes are lost on deploy (`apps/server/src/index.ts`).

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