import type { MermaidGraph, MermaidNode, MermaidSubgraph, MermaidEdge } from '../mermaid';
import type { RepoComponent, RepoModel, RepoResource } from './analyze';

/** Subgraph id used for a component (stable, so drift can find it again). */
export const componentKey = (id: string) => `c_${id.replace(/[^A-Za-z0-9]/g, '_') || 'root'}`;
/** Node id used for a resource (a datastore, queue or service the code uses). */
export const resourceKey = (id: string) => `r_${id.replace(/[^A-Za-z0-9]/g, '_')}`;

/** More than this many libraries are grouped behind one "Shared packages" level. */
const GROUP_LIBRARIES_ABOVE = 3;
export const SHARED_GROUP = 'g_shared';

export interface RepoGraph {
  graph: MermaidGraph;
  /** Subgraph id → component it stands for (to link portals to code). */
  components: Map<string, RepoComponent>;
}

const resourceShape = (r: RepoResource): MermaidNode['shape'] =>
  r.kind === 'external' ? 'stadium' : 'cylinder';

const edgeLabel = (r: RepoResource) =>
  r.kind === 'datastore' ? 'reads/writes' : r.kind === 'queue' ? 'publishes' : 'calls';

/**
 * The repo as a nested map: apps (and the shared-packages group) at the top
 * with the datastores and services they use; each component is a level of
 * its own showing its main folders.
 */
export function repoToGraph(model: RepoModel): RepoGraph {
  const nodes = new Map<string, MermaidNode>();
  const subgraphs = new Map<string, MermaidSubgraph>();
  const edges: MermaidEdge[] = [];
  const components = new Map<string, RepoComponent>();

  const libraries = model.components.filter((c) => c.kind === 'library');
  const grouped = libraries.length > GROUP_LIBRARIES_ABOVE;
  if (grouped) {
    subgraphs.set(SHARED_GROUP, {
      id: SHARED_GROUP,
      title: 'Shared packages',
      parent: null,
      direction: 'LR',
    });
  }

  for (const c of model.components) {
    const key = componentKey(c.id);
    components.set(key, c);
    subgraphs.set(key, {
      id: key,
      title: c.name,
      parent: grouped && c.kind === 'library' ? SHARED_GROUP : null,
      direction: 'TB',
    });
    if (c.modules.length === 0) {
      nodes.set(`${key}__about`, {
        id: `${key}__about`,
        label: c.description ?? c.path,
        shape: 'round',
        subgraph: key,
      });
    }
    for (const m of c.modules) {
      const id = `${key}__${m.name.replace(/[^A-Za-z0-9]/g, '_')}`;
      nodes.set(id, {
        id,
        label: `${m.name} (${m.files} ${m.files === 1 ? 'file' : 'files'})`,
        shape: 'rect',
        subgraph: key,
      });
    }
  }

  for (const r of model.resources) {
    nodes.set(resourceKey(r.id), {
      id: resourceKey(r.id),
      label: r.name,
      shape: resourceShape(r),
      subgraph: null,
    });
  }

  const resourceById = new Map(model.resources.map((r) => [r.id, r]));
  for (const c of model.components) {
    for (const dep of c.dependsOn) {
      edges.push({
        from: componentKey(c.id),
        to: componentKey(dep),
        label: 'uses',
        style: 'solid',
        arrowStart: false,
        arrowEnd: true,
      });
    }
    for (const use of c.uses) {
      const r = resourceById.get(use);
      if (!r) continue;
      edges.push({
        from: componentKey(c.id),
        to: resourceKey(r.id),
        label: edgeLabel(r),
        style: r.kind === 'external' ? 'dotted' : 'solid',
        arrowStart: false,
        arrowEnd: true,
      });
    }
  }

  return { graph: { direction: 'LR', nodes, edges, subgraphs }, components };
}

// ── Drift ─────────────────────────────────────────────────────────────

export type DriftChange =
  | { kind: 'component-added'; component: RepoComponent }
  | { kind: 'component-removed'; component: RepoComponent }
  | { kind: 'dependency-added'; from: RepoComponent; to: RepoComponent }
  | { kind: 'dependency-removed'; from: RepoComponent; to: RepoComponent }
  | { kind: 'resource-added'; from: RepoComponent; resource: RepoResource }
  | { kind: 'resource-removed'; from: RepoComponent; resource: RepoResource };

/**
 * What changed in the code since the map was generated from it: components
 * that appeared or disappeared, and dependencies (between components, or on
 * datastores/services) that were added or dropped.
 */
export function diffModels(before: RepoModel, after: RepoModel): DriftChange[] {
  const changes: DriftChange[] = [];
  const oldC = new Map(before.components.map((c) => [c.id, c]));
  const newC = new Map(after.components.map((c) => [c.id, c]));
  const oldR = new Map(before.resources.map((r) => [r.id, r]));
  const newR = new Map(after.resources.map((r) => [r.id, r]));

  for (const c of after.components)
    if (!oldC.has(c.id)) changes.push({ kind: 'component-added', component: c });
  for (const c of before.components)
    if (!newC.has(c.id)) changes.push({ kind: 'component-removed', component: c });

  for (const c of after.components) {
    const prev = oldC.get(c.id);
    if (!prev) continue;
    for (const d of c.dependsOn) {
      if (!prev.dependsOn.includes(d) && newC.has(d))
        changes.push({ kind: 'dependency-added', from: c, to: newC.get(d)! });
    }
    for (const d of prev.dependsOn) {
      if (!c.dependsOn.includes(d) && newC.has(d))
        changes.push({ kind: 'dependency-removed', from: c, to: newC.get(d)! });
    }
    for (const u of c.uses) {
      if (!prev.uses.includes(u))
        changes.push({ kind: 'resource-added', from: c, resource: newR.get(u)! });
    }
    for (const u of prev.uses) {
      if (!c.uses.includes(u)) {
        changes.push({ kind: 'resource-removed', from: c, resource: oldR.get(u) ?? newR.get(u)! });
      }
    }
  }
  return changes;
}

/** One line per change, as a person would say it. */
export function describeDrift(change: DriftChange): string {
  switch (change.kind) {
    case 'component-added':
      return `New ${change.component.kind === 'app' ? 'app' : 'package'} in the code: ${change.component.name} (${change.component.path})`;
    case 'component-removed':
      return `${change.component.name} is gone from the code (${change.component.path})`;
    case 'dependency-added':
      return `${change.from.name} now depends on ${change.to.name}`;
    case 'dependency-removed':
      return `${change.from.name} no longer depends on ${change.to.name}`;
    case 'resource-added':
      return `${change.from.name} now uses ${change.resource.name}`;
    case 'resource-removed':
      return `${change.from.name} no longer uses ${change.resource.name}`;
  }
}
