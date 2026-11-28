import type { Diagram, MavisElement } from '@mavisdraw/types';
import {
  apiListDiagrams,
  ApiError,
  apiCreateDiagram,
  apiGetDiagram,
  type DiagramResponse,
} from './api';
import { useElementsStore, withoutHistory } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { recordSaved } from './saveTracker';
import { applyDeferred, diagramConfirmed, journalNewDiagram } from './offlineJournal';

/**
 * Keeps the diagram hierarchy in sync with the server:
 *  - nested diagrams created in the editor are created on the server (with
 *    the client's id, idempotently), so their contents can be saved;
 *  - a diagram's elements are fetched the first time it's opened.
 *
 * State is per opened project; call `resetDiagramSync()` when switching.
 */

const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();
const creating = new Map<string, Promise<void>>();
const known = new Set<string>();

export function resetDiagramSync(serverDiagramIds: Iterable<string> = []): void {
  loaded.clear();
  loading.clear();
  creating.clear();
  known.clear();
  for (const id of serverDiagramIds) known.add(id);
}

/** Mark a diagram whose elements are already in the store (root on open, brand-new children). */
export function markDiagramLoaded(id: string): void {
  loaded.add(id);
}

export function isDiagramLoaded(id: string): boolean {
  return loaded.has(id);
}

export function toDiagram(d: DiagramResponse): Diagram {
  return {
    id: d.id,
    projectId: d.projectId,
    parentDiagramId: d.parentDiagramId,
    parentPortalId: d.parentPortalId,
    title: d.title,
    viewBackgroundColor: d.viewBackgroundColor,
    gridEnabled: d.gridEnabled,
    gridSize: d.gridSize,
    renderMode: d.renderMode as Diagram['renderMode'],
    layers: d.layers as Diagram['layers'],
    createdBy: d.createdBy,
    createdAt: new Date(d.createdAt).getTime(),
    updatedAt: new Date(d.updatedAt).getTime(),
  };
}

/**
 * Create the diagram on the server if it isn't there yet. Parents are created
 * first. Safe to call repeatedly and concurrently.
 */
export function ensureDiagramOnServer(diagram: Diagram): Promise<void> {
  if (known.has(diagram.id)) return Promise.resolve();
  const pending = creating.get(diagram.id);
  if (pending) return pending;

  const promise = (async () => {
    if (diagram.parentDiagramId) {
      const parent = useDiagramStore.getState().diagrams.get(diagram.parentDiagramId);
      if (parent) await ensureDiagramOnServer(parent);
    }
    await apiCreateDiagram({
      id: diagram.id,
      projectId: diagram.projectId,
      parentDiagramId: diagram.parentDiagramId,
      parentPortalId: diagram.parentPortalId,
      title: diagram.title,
    });
    known.add(diagram.id);
    // The offline journal no longer needs to keep it
    diagramConfirmed(diagram.id);
  })().finally(() => creating.delete(diagram.id));

  creating.set(diagram.id, promise);
  return promise;
}

/**
 * Merge server elements into the store without clobbering newer local edits
 * (an element changed locally while the fetch was in flight wins).
 */
export function mergeServerElements(serverElements: MavisElement[]): void {
  if (serverElements.length === 0) return;
  withoutHistory(() =>
    useElementsStore.setState((prev) => {
      const next = new Map(prev.elements);
      let changed = false;
      for (const el of serverElements) {
        const local = next.get(el.id);
        if (!local || local.version < el.version) {
          next.set(el.id, el);
          changed = true;
        }
      }
      return changed ? { elements: next } : prev;
    }),
  );
}

/** Fetch a diagram's elements the first time it's opened. */
export function loadDiagramElements(diagramId: string): Promise<void> {
  if (loaded.has(diagramId)) return Promise.resolve();
  const pending = loading.get(diagramId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const { diagram } = await apiGetDiagram(diagramId);
      known.add(diagramId);
      const serverElements = (diagram.elements ?? []) as MavisElement[];
      mergeServerElements(serverElements);
      // What the server has is, by definition, saved
      recordSaved(
        diagramId,
        serverElements,
        useDiagramStore.getState().diagrams.get(diagramId)?.updatedAt,
      );
      loaded.add(diagramId);
      // Unsaved edits kept from a session in which this level didn't load
      applyDeferred(diagramId);
    } catch (err) {
      // Created locally and not yet on the server: nothing to load
      if (err instanceof ApiError && err.statusCode === 404) {
        loaded.add(diagramId);
        return;
      }
      throw err;
    }
  })().finally(() => loading.delete(diagramId));

  loading.set(diagramId, promise);
  return promise;
}

let listing: Promise<void> | null = null;

function currentProjectId(): string | null {
  const { diagrams, activeDiagramId } = useDiagramStore.getState();
  return (
    diagrams.get(activeDiagramId)?.projectId ?? diagrams.values().next().value?.projectId ?? null
  );
}

/**
 * Pull in nested diagrams that collaborators created after this project was
 * opened (their portals arrive live; the diagrams behind them don't).
 * Existing diagrams are left untouched. Concurrent calls share one request.
 */
export function refreshDiagramList(projectId: string | null = currentProjectId()): Promise<void> {
  if (!projectId) return Promise.resolve();
  if (listing) return listing;
  listing = (async () => {
    const { diagrams } = await apiListDiagrams(projectId);
    const have = useDiagramStore.getState().diagrams;
    const missing = diagrams.filter((d) => !have.has(d.id));
    if (missing.length === 0) return;
    for (const d of missing) known.add(d.id);
    useDiagramStore.setState((s) => {
      const next = new Map(s.diagrams);
      for (const d of missing) if (!next.has(d.id)) next.set(d.id, toDiagram(d));
      return { diagrams: next };
    });
  })()
    .catch((err) => console.error('Failed to refresh diagram list:', err))
    .finally(() => {
      listing = null;
    });
  return listing;
}

/** True once the diagram is in the store, fetching the project's list if needed. */
export async function ensureDiagramKnown(diagramId: string): Promise<boolean> {
  if (useDiagramStore.getState().diagrams.has(diagramId)) return true;
  await refreshDiagramList();
  return useDiagramStore.getState().diagrams.has(diagramId);
}

/**
 * Open a diagram of the current project (any level), loading its contents
 * first. False when it doesn't exist (anymore).
 */
export async function goToDiagram(diagramId: string): Promise<boolean> {
  if (!(await ensureDiagramKnown(diagramId))) return false;
  const diagrams = useDiagramStore.getState();
  if (diagrams.activeDiagramId !== diagramId) {
    diagrams.navigateToDiagram(diagramId);
    await loadDiagramElements(diagramId).catch(() => undefined);
    // Let the canvas pick up the new diagram before anything moves the viewport
    await new Promise((r) => requestAnimationFrame(r));
  }
  return true;
}

/**
 * A child diagram was just created in the editor (e.g. by drawing a portal):
 * nothing to load, track it for saving, and create it on the server now.
 */
export function registerNewDiagram(diagram: Diagram): void {
  loaded.add(diagram.id);
  recordSaved(diagram.id, [], diagram.updatedAt);
  // Until the server has it, the device does (drawn offline, it outlives the tab)
  journalNewDiagram(diagram);
  ensureDiagramOnServer(diagram).catch((err) => {
    // Autosave retries the create on its next save of this diagram
    console.error('Failed to create nested diagram on the server:', err);
  });
}

/**
 * Nested diagrams made on this device that the server never got (drawn
 * offline, the tab closed before reconnecting): put back into the project,
 * parents first, so the edits made in them have somewhere to go. Returns
 * the ones put back (they're created on the server as usual).
 */
export function recreateDiagrams(journaled: Diagram[]): Diagram[] {
  const recreated: Diagram[] = [];
  let waiting = journaled.filter((d) => !useDiagramStore.getState().diagrams.has(d.id));
  // A child can only come back once its parent is there
  for (let progress = true; progress && waiting.length > 0; ) {
    progress = false;
    const still: Diagram[] = [];
    for (const d of waiting) {
      const diagrams = useDiagramStore.getState().diagrams;
      if (d.parentDiagramId && !diagrams.has(d.parentDiagramId)) {
        still.push(d);
        continue;
      }
      useDiagramStore.setState({ diagrams: new Map(diagrams).set(d.id, d) });
      registerNewDiagram(d);
      recreated.push(d);
      progress = true;
    }
    waiting = still;
  }
  return recreated;
}
