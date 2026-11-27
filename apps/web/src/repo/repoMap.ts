import {
  analyzeRepo,
  diffModels,
  isManifest,
  isRelevantPath,
  repoToGraph,
  SHARED_GROUP,
  type DriftChange,
  type RepoComponent,
  type RepoModel,
  type RepoResource,
  type RepoSnapshot,
} from '@mavisdraw/compat';
import type { MavisElement, PortalElement, TextElement } from '@mavisdraw/types';
import { apiGetRepoSnapshot, apiSetProjectRepo, type RepoSourceData } from '../services/api';
import { useElementsStore } from '../stores/elementsStore';
import { useDiagramStore } from '../stores/diagramStore';
import { useCommentsStore } from '../stores/commentsStore';
import { importMermaidGraph } from '../import/mermaidImport';
import { connectElements, makeLabel } from '../editor/elementFactory';
import { loadDiagramElements } from '../services/diagramSync';
import { getCanvasController } from '../components/canvas/canvasController';
import { useRepoStore } from './repoStore';

export { useRepoStore };

export type RepoSourceInput = Omit<RepoSourceData, 'model' | 'generatedAt' | 'generatedBy'>;

const projectId = () => useCommentsStore.getState().projectId;

// ── Snapshots ──────────────────────────────────────────────────────────

/** A folder picked in the browser (input with webkitdirectory). */
export async function snapshotFromFolder(fileList: FileList | File[]): Promise<RepoSnapshot> {
  const files = Array.from(fileList);
  const rel = (f: File) =>
    (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const root = rel(files[0] ?? new File([], 'repo')).split('/')[0];
  const strip = (p: string) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p);
  const relevant = files.filter((f) => isRelevantPath(strip(rel(f))));
  const manifests = new Map<string, string>();
  await Promise.all(
    relevant
      .filter((f) => isManifest(strip(rel(f))) && f.size < 512 * 1024)
      .map(async (f) => manifests.set(strip(rel(f)), await f.text())),
  );
  return { name: root, files: relevant.map((f) => strip(rel(f))), read: (p) => manifests.get(p) };
}

export async function snapshotFromGitHub(
  connectionId: string,
  owner: string,
  repo: string,
  ref?: string,
): Promise<{ snapshot: RepoSnapshot; ref: string; truncated: boolean }> {
  const { snapshot } = await apiGetRepoSnapshot(connectionId, owner, repo, ref);
  return {
    snapshot: { name: snapshot.name, files: snapshot.files, read: (p) => snapshot.manifests[p] },
    ref: snapshot.ref,
    truncated: snapshot.truncated,
  };
}

// ── Generate ───────────────────────────────────────────────────────────

export interface GenerateResult {
  components: number;
  resources: number;
  diagrams: number;
}

/**
 * Turn a repository into a nested map on the current level: a portal per
 * app/package (linked to its folder), its main folders one level down, and
 * the datastores and services it uses.
 */
export async function generateMapFromRepo(
  snapshot: RepoSnapshot,
  source: RepoSourceInput,
): Promise<GenerateResult> {
  const model = analyzeRepo(snapshot);
  const { graph, components } = repoToGraph(model);
  const at = freeSpotOnActiveDiagram();
  const result = await importMermaidGraph(graph, at, {
    portalExtras: (sgId) => {
      const c = components.get(sgId);
      return c ? linkFields(c, source) : undefined;
    },
  });
  await saveBaseline(source, model);
  return {
    components: model.components.length,
    resources: model.resources.length,
    diagrams: result.diagrams,
  };
}

function linkFields(
  c: RepoComponent,
  source: Pick<RepoSourceInput, 'kind' | 'owner' | 'repo' | 'ref'>,
): Partial<PortalElement> {
  return {
    codePath: c.path,
    githubLink:
      source.kind === 'github' && source.owner && source.repo
        ? {
            owner: source.owner,
            repo: source.repo,
            path: c.path === '.' ? '' : c.path,
            ref: source.ref ?? 'HEAD',
          }
        : null,
  };
}

/** Make `model` the baseline drift is measured against. */
export async function saveBaseline(source: RepoSourceInput, model: RepoModel): Promise<void> {
  const id = projectId();
  if (!id) return;
  const { repoSource } = await apiSetProjectRepo(id, { ...source, model });
  useRepoStore.getState().setSource(repoSource);
}

function freeSpotOnActiveDiagram(): { x: number; y: number } {
  const diagramId = useDiagramStore.getState().activeDiagramId;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const el of useElementsStore.getState().elements.values()) {
    if (el.diagramId !== diagramId || el.isDeleted) continue;
    maxX = Math.max(maxX, el.x + el.width);
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.height);
  }
  if (maxX === -Infinity) return getCanvasController()?.getPasteAnchor() ?? { x: 0, y: 0 };
  return { x: maxX + 400, y: (minY + maxY) / 2 };
}

// ── Drift ──────────────────────────────────────────────────────────────

/** Compare the code now with the map's baseline. */
export function checkDrift(snapshot: RepoSnapshot): DriftChange[] {
  const { source } = useRepoStore.getState();
  if (!source) return [];
  const latest = analyzeRepo(snapshot);
  const drift = diffModels(source.model, latest);
  useRepoStore.setState({ latest, drift, applied: new Set() });
  return drift;
}

/** Accept the latest analysis as the new baseline (the map is up to date). */
export async function markUpToDate(): Promise<void> {
  const { source, latest } = useRepoStore.getState();
  if (!source || !latest) return;
  const { model: _model, generatedAt: _a, generatedBy: _b, ...input } = source;
  await saveBaseline(input, latest);
}

const live = () =>
  Array.from(useElementsStore.getState().elements.values()).filter((e) => !e.isDeleted);

/** The portal standing for a component, wherever it is in the map. */
export function portalForPath(path: string): PortalElement | undefined {
  return live().find(
    (e): e is PortalElement => e.type === 'portal' && (e as PortalElement).codePath === path,
  );
}

function labelOf(el: MavisElement): string | undefined {
  const id = el.boundElements.find((b) => b.type === 'text')?.id;
  return id
    ? (useElementsStore.getState().elements.get(id) as TextElement | undefined)?.text
    : undefined;
}

/** Make sure every level of the project is loaded (portals may be anywhere). */
export async function loadAllLevels(): Promise<void> {
  const ids = Array.from(useDiagramStore.getState().diagrams.keys());
  await Promise.all(ids.map((id) => loadDiagramElements(id).catch(() => undefined)));
}

/** Commit new/changed elements as one undo step. */
function commit(elements: MavisElement[]): void {
  const store = useElementsStore.getState();
  store.pushHistory();
  useElementsStore.setState((prev) => {
    const next = new Map(prev.elements);
    for (const el of elements) next.set(el.id, el);
    return { elements: next };
  });
}

function connect(from: MavisElement, to: MavisElement, label: string, dotted = false): void {
  const a = { ...from, boundElements: [...from.boundElements] } as MavisElement;
  const b = { ...to, boundElements: [...to.boundElements] } as MavisElement;
  const arrow = connectElements(from.diagramId, a, b, {
    style: dotted ? 'dotted' : 'solid',
    arrowEnd: true,
  });
  const text = makeLabel(from.diagramId, arrow, label, 16);
  arrow.boundElements = [{ id: text.id, type: 'text' }];
  commit([a, b, arrow, text]);
}

function arrowBetween(fromId: string, toId: string): MavisElement | undefined {
  return live().find(
    (e) =>
      e.type === 'arrow' &&
      (e as unknown as { startBinding?: { elementId: string } }).startBinding?.elementId ===
        fromId &&
      (e as unknown as { endBinding?: { elementId: string } }).endBinding?.elementId === toId,
  );
}

/** Where a component's portal goes: inside "Shared packages" for a library, if the map has it. */
function levelFor(c: RepoComponent): string {
  const root = useDiagramStore.getState().diagramPath[0];
  if (c.kind !== 'library') return root;
  const group = live().find(
    (e): e is PortalElement =>
      e.type === 'portal' && (e as PortalElement).label === 'Shared packages',
  );
  return group?.targetDiagramId ?? root;
}

async function showLevel(diagramId: string): Promise<void> {
  const diagrams = useDiagramStore.getState();
  if (diagrams.activeDiagramId !== diagramId) {
    diagrams.navigateToDiagram(diagramId);
    await loadDiagramElements(diagramId).catch(() => undefined);
    await new Promise((r) => requestAnimationFrame(r));
  }
}

export function focusElement(el: MavisElement): void {
  void showLevel(el.diagramId).then(() =>
    getCanvasController()?.centerOn?.({ x: el.x + el.width / 2, y: el.y + el.height / 2 }),
  );
}

/**
 * Bring the map in line with one change in the code. Returns a message when
 * it can't (e.g. the two components are on different levels).
 */
export async function applyDrift(change: DriftChange): Promise<string | null> {
  const { source } = useRepoStore.getState();
  if (!source) return 'This map is not linked to a repository';
  await loadAllLevels();

  switch (change.kind) {
    case 'component-added': {
      const level = levelFor(change.component);
      await showLevel(level);
      const { graph, components } = repoToGraph({
        name: '',
        components: [change.component],
        resources: [],
      });
      graph.subgraphs.delete(SHARED_GROUP);
      for (const sg of graph.subgraphs.values()) sg.parent = null;
      await importMermaidGraph(graph, freeSpotOnActiveDiagram(), {
        portalExtras: (sgId) => {
          const c = components.get(sgId);
          return c ? linkFields(c, source) : undefined;
        },
      });
      return null;
    }
    case 'component-removed': {
      const portal = portalForPath(change.component.path);
      if (!portal) return null; // already gone from the map
      useElementsStore.getState().deleteElements([portal.id]);
      return null;
    }
    case 'dependency-added': {
      const from = portalForPath(change.from.path);
      const to = portalForPath(change.to.path);
      if (!from || !to) return `Add ${!from ? change.from.name : change.to.name} to the map first`;
      if (from.diagramId !== to.diagramId) {
        // Draw it at the level where both are visible: to the group that holds the target
        const holder = live().find(
          (e): e is PortalElement =>
            e.type === 'portal' && (e as PortalElement).targetDiagramId === to.diagramId,
        );
        if (!holder || holder.diagramId !== from.diagramId) {
          return `${change.from.name} and ${change.to.name} are on different levels`;
        }
        if (!arrowBetween(from.id, holder.id)) connect(from, holder, 'uses');
        return null;
      }
      if (!arrowBetween(from.id, to.id)) connect(from, to, 'uses');
      return null;
    }
    case 'dependency-removed': {
      const from = portalForPath(change.from.path);
      const to = portalForPath(change.to.path);
      const arrow = from && to ? arrowBetween(from.id, to.id) : undefined;
      if (arrow) useElementsStore.getState().deleteElements([arrow.id]);
      return null;
    }
    case 'resource-added': {
      const from = portalForPath(change.from.path);
      if (!from) return `Add ${change.from.name} to the map first`;
      const resource =
        resourceNode(from.diagramId, change.resource) ?? addResourceNode(from, change.resource);
      if (!arrowBetween(from.id, resource.id)) {
        connect(from, resource, edgeLabel(change.resource), change.resource.kind === 'external');
      }
      return null;
    }
    case 'resource-removed': {
      const from = portalForPath(change.from.path);
      const resource = from ? resourceNode(from.diagramId, change.resource) : undefined;
      const arrow = from && resource ? arrowBetween(from.id, resource.id) : undefined;
      if (arrow) useElementsStore.getState().deleteElements([arrow.id]);
      return null;
    }
  }
}

const edgeLabel = (r: RepoResource) =>
  r.kind === 'datastore' ? 'reads/writes' : r.kind === 'queue' ? 'publishes' : 'calls';

function resourceNode(diagramId: string, r: RepoResource): MavisElement | undefined {
  return live().find(
    (e) => e.diagramId === diagramId && e.type === 'rectangle' && labelOf(e) === r.name,
  );
}

function addResourceNode(near: MavisElement, r: RepoResource): MavisElement {
  const store = useElementsStore.getState();
  const shape = store.createElement(
    'rectangle',
    near.diagramId,
    near.x,
    near.y + near.height + 160,
    180,
    70,
  );
  (shape as { roundness?: number }).roundness = r.kind === 'external' ? 35 : 16;
  const text = makeLabel(near.diagramId, shape, r.name, 20);
  shape.boundElements = [{ id: text.id, type: 'text' }];
  commit([shape, text]);
  return useElementsStore.getState().elements.get(shape.id)!;
}
