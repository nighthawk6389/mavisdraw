# Backlog

Items noticed during PR #9 review (arrow improvements) that weren't fixed immediately.

## Observability

- **Keep server-side logging** — All try/catch blocks in `apps/server/src/` must log caught exceptions using `request.log` (in routes/middleware) or `console.error` (in services). Never swallow errors silently. This is critical for debugging production issues.

## Code Quality

- **Duplicate `AnchorPosition` type** — `AnchorPosition` is defined in both `packages/types/src/elements.ts` and `apps/web/src/components/canvas/HitTesting.ts`. Consolidate into `@mavisdraw/types` and import from there.

- **`hoveredAnchor` typed as `string | null`** — Should be `AnchorPosition | null` in `InteractionManager.ts` for type safety.

- **`new Set()` allocated on every call** in `startTextEditing` (Canvas.tsx:122) and `handleDoubleClick` (InteractionManager.ts:1007). Extract to module-level constants like `SHAPE_TOOLS`.

- **`'points' in el` runtime check** used in multiple places (CanvasRenderer.ts:1532, elementsStore.ts:45) instead of discriminated union narrowing (`el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw'`). Fragile if other element types ever gain a `points` property.

- **`bound.type === 'line'` is dead code** in `moveElementWithBindings` (elementsStore.ts:760). `bindArrow` always sets type to `'arrow'` (line 662), so the `'line'` branch never runs. Either binding should set the actual element type, or the dead branch should be removed.

- **`DEFAULT_STYLE.seed` computed once at module load** (elementsStore.ts:106). `createElement` overrides it, but `createBoundText` spreads `DEFAULT_STYLE` directly — all bound text elements share the same Rough.js seed.

- **Unused `vp` variable** in paste handler (Canvas.tsx:760). Dead code.

- **`getContentBounds` duplicates existing logic** (Canvas.tsx:914-938). Should reuse `CanvasRenderer.getElementsBounds()` or consolidate into `@mavisdraw/math`.

## Performance

- **`handleKeyDown` callback recreated on every element change** — `selectedIds` is in the dependency array of `useKeyboard`'s `handleKeyDown`, causing the `keydown` listener to be rebound whenever selection changes. Could use a ref for `selectedIds` similar to the `elements` fix.

- **`moveElementWithBindings` doesn't call `pushHistory`** — This is intentional (caller manages history), but inconsistent with all other mutation methods. Document the contract or add an internal `_skipHistory` flag for clarity.

## Architecture

- **Implicit `as Partial<LinearElement>` casts** throughout when calling `updateElement` with linear-specific fields like `points` or `routingMode`. A type-safe approach would use typed overloads or a generic `updateElement<T extends MavisElement>`.

- **`createElement` name is misleading** — It only creates and returns an element object with defaults but does not add it to the store. Renaming to `buildElement` or `createElementTemplate` would clarify the contract.

- **`moveElementWithBindings` inconsistent history contract** — Unlike all other mutation methods which call `pushHistory()` internally, this one relies on the caller to have already pushed. Should be documented or unified.

## Testing

- **No e2e tests for multi-element resize** — The `performResize` multi-element branch was broken (used position as width). Add e2e coverage for resizing multiple selected elements.

- **No e2e tests for undo during drag** — History flooding was fixed, but there's no test verifying that a single undo reverses an entire drag operation.
