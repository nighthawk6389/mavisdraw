import type {
  Diagram,
  LinearElement,
  MavisDrawScene,
  MavisElement,
  ModelComponent,
  ModelComponentKind,
  ModelRelationship,
  PortalElement,
  ProjectModel,
  StoredComponent,
  StoredRelationship,
} from '@mavisdraw/types';
import { getBoundText, getGivenLabel } from './labels.js';

/**
 * The project's architecture model, computed from its diagrams' elements
 * (identity and names ride on the shapes) plus stored details (see
 * docs/model-layer.md). Pure, so the server, the editor and tests agree.
 */

export const MODEL_COMPONENT_KINDS: ModelComponentKind[] = [
  'service',
  'datastore',
  'queue',
  'external',
  'system',
  'person',
  'other',
];

export const relationshipId = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`;

/** Shapes that can show a component (not wiring, text or doodles). */
const NOT_COMPONENTS = new Set(['text', 'arrow', 'line', 'freedraw', 'image']);

export const canShowComponent = (el: Pick<MavisElement, 'type'>) => !NOT_COMPONENTS.has(el.type);

/**
 * Which component a shape shows: its componentId, or — for a labelled shape
 * from before the model existed — its own id (backfill assigns that same id,
 * so ids don't change). Unlabelled, unlinked shapes are plain drawing.
 */
export function componentKeyOf(el: MavisElement, byId: Map<string, MavisElement>): string | null {
  if (el.isDeleted || !canShowComponent(el)) return null;
  if (el.componentId) return el.componentId;
  return getGivenLabel(el, byId) ? el.id : null;
}

function defaultKind(el: MavisElement): ModelComponentKind {
  if (el.type === 'portal') return 'system';
  if (el.type === 'ellipse' || el.type === 'cylinder') return 'datastore';
  if (el.type === 'queue') return 'queue';
  return 'service';
}

function codeOf(el: MavisElement, repo?: string): ModelComponent['code'] {
  if (el.type !== 'portal') return null;
  const portal = el as PortalElement;
  const link = portal.githubLink;
  const path = (portal.codePath ?? link?.path ?? '').replace(/^\/+|\/+$/g, '');
  if (!path && !link) return null;
  const linkedRepo = link ? `${link.owner}/${link.repo}` : repo;
  return linkedRepo ? { repo: linkedRepo, path } : { path };
}

/** The most common label among a component's appearances (renames converge on one). */
function majority(labels: string[]): string | null {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [label, n] of counts) {
    if (n > most) {
      best = label;
      most = n;
    }
  }
  return best;
}

export interface BuildModelOptions {
  /** "owner/repo" the map was generated from: the default repo of code links. */
  repo?: string | null;
}

export function buildProjectModel(
  scene: MavisDrawScene,
  stored: { components: StoredComponent[]; relationships: StoredRelationship[] } = {
    components: [],
    relationships: [],
  },
  options: BuildModelOptions = {},
): ProjectModel {
  const diagrams = new Map<string, Diagram>(scene.diagrams.map((d) => [d.id, d]));
  const live = scene.elements.filter((el) => !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));

  // Diagram titles from the top down
  const pathCache = new Map<string, string[]>();
  const pathOf = (id: string, seen = new Set<string>()): string[] => {
    const hit = pathCache.get(id);
    if (hit) return hit;
    const d = diagrams.get(id);
    if (!d || seen.has(id)) return [];
    seen.add(id);
    const path = [...(d.parentDiagramId ? pathOf(d.parentDiagramId, seen) : []), d.title];
    pathCache.set(id, path);
    return path;
  };

  // ── Appearances, grouped by component
  const elementComponent = new Map<string, string>();
  const shapes = new Map<string, MavisElement[]>();
  for (const el of live) {
    const key = componentKeyOf(el, byId);
    if (!key) continue;
    elementComponent.set(el.id, key);
    const list = shapes.get(key) ?? [];
    list.push(el);
    shapes.set(key, list);
  }
  const storedById = new Map(stored.components.map((c) => [c.id, c]));

  const components = new Map<string, ModelComponent>();
  for (const [id, els] of shapes) {
    const meta = storedById.get(id);
    const labels = els.map((el) => getGivenLabel(el, byId)).filter((l): l is string => !!l);
    const portal = els.find(
      (el) => el.type === 'portal' && diagrams.has((el as PortalElement).targetDiagramId),
    ) as PortalElement | undefined;
    const coded = els.map((el) => codeOf(el, options.repo ?? undefined)).find(Boolean) ?? null;
    components.set(id, {
      id,
      name: majority(labels) ?? meta?.name ?? 'Unnamed',
      kind: meta?.kind ?? defaultKind(portal ?? els[0]),
      description: meta?.description ?? null,
      technology: meta?.technology ?? null,
      owner: meta?.owner ?? null,
      tags: meta?.tags ?? [],
      links: meta?.links ?? [],
      code: coded,
      detailDiagramId: portal ? portal.targetDiagramId : null,
      appearances: els.map((el) => ({
        diagramId: el.diagramId,
        elementId: el.id,
        path: pathOf(el.diagramId),
      })),
      parents: [],
      stored: !!meta,
    });
  }
  // Model-only components (recorded, not drawn anywhere)
  for (const meta of stored.components) {
    if (components.has(meta.id)) continue;
    components.set(meta.id, {
      id: meta.id,
      name: meta.name,
      kind: meta.kind ?? 'service',
      description: meta.description ?? null,
      technology: meta.technology ?? null,
      owner: meta.owner ?? null,
      tags: meta.tags ?? [],
      links: meta.links ?? [],
      code: null,
      detailDiagramId: null,
      appearances: [],
      parents: [],
      stored: true,
    });
  }

  // ── Containment: a component sits inside the one whose detail diagram it's
  // drawn on — unless it's only there as context: external systems and
  // people never are, and neither is anything also drawn outside that
  // component's levels (a shared Postgres drawn next to the API, too)
  const ownerOfDiagram = new Map<string, string>();
  for (const c of components.values()) {
    if (c.detailDiagramId && !ownerOfDiagram.has(c.detailDiagramId)) {
      ownerOfDiagram.set(c.detailDiagramId, c.id);
    }
  }
  const levelsCache = new Map<string, Set<string>>();
  /** A diagram and every diagram above it. */
  const levelsOf = (diagramId: string): Set<string> => {
    let hit = levelsCache.get(diagramId);
    if (!hit) {
      hit = new Set<string>();
      for (let d = diagrams.get(diagramId); d && !hit.has(d.id); ) {
        hit.add(d.id);
        d = d.parentDiagramId ? diagrams.get(d.parentDiagramId) : undefined;
      }
      levelsCache.set(diagramId, hit);
    }
    return hit;
  };
  for (const c of components.values()) {
    if (c.kind === 'external' || c.kind === 'person') continue;
    const parents = new Set<string>();
    for (const a of c.appearances) {
      const owner = ownerOfDiagram.get(a.diagramId);
      if (!owner || owner === c.id) continue;
      const detail = components.get(owner)!.detailDiagramId!;
      if (c.appearances.every((other) => levelsOf(other.diagramId).has(detail))) {
        parents.add(owner);
      }
    }
    c.parents = Array.from(parents);
  }

  // ── Relationships: drawn arrows between appearances, plus stored ones
  const relationships = new Map<string, ModelRelationship>();
  const relationship = (sourceId: string, targetId: string) => {
    const id = relationshipId(sourceId, targetId);
    let r = relationships.get(id);
    if (!r) {
      r = {
        id,
        sourceId,
        targetId,
        description: null,
        technology: null,
        labels: [],
        drawn: [],
        stored: false,
      };
      relationships.set(id, r);
    }
    return r;
  };
  for (const el of live) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const conn = el as LinearElement;
    const source = conn.startBinding
      ? elementComponent.get(conn.startBinding.elementId)
      : undefined;
    const target = conn.endBinding ? elementComponent.get(conn.endBinding.elementId) : undefined;
    if (!source || !target || source === target) continue;
    const r = relationship(source, target);
    r.drawn.push({ diagramId: el.diagramId, elementId: el.id });
    const label = getBoundText(conn, byId);
    if (label && !r.labels.includes(label)) r.labels.push(label);
  }
  for (const meta of stored.relationships) {
    if (!components.has(meta.sourceId) || !components.has(meta.targetId)) continue;
    if (meta.sourceId === meta.targetId) continue;
    const r = relationship(meta.sourceId, meta.targetId);
    r.description = meta.description ?? null;
    r.technology = meta.technology ?? null;
    r.stored = true;
  }

  const name = (id: string) => components.get(id)?.name ?? '';
  return {
    components: Array.from(components.values()).sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    ),
    relationships: Array.from(relationships.values()).sort(
      (a, b) =>
        name(a.sourceId).localeCompare(name(b.sourceId)) ||
        name(a.targetId).localeCompare(name(b.targetId)),
    ),
  };
}

// ── Questions about the model ────────────────────────────────

export function componentById(model: ProjectModel, id: string): ModelComponent | undefined {
  return model.components.find((c) => c.id === id);
}

/** Everything inside a component, at any depth (through detail diagrams). */
export function descendantsOf(model: ProjectModel, id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of model.components) {
    for (const p of c.parents) children.set(p, [...(children.get(p) ?? []), c.id]);
  }
  const out = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next === id || out.has(next)) continue;
    out.add(next);
    stack.push(...(children.get(next) ?? []));
  }
  return out;
}

export interface Dependency {
  relationship: ModelRelationship;
  /** The other end. */
  componentId: string;
  /** Inside the component, which one actually has this relationship (null: itself). */
  via: string | null;
}

/**
 * What a component depends on — with `rollup`, including what anything
 * inside it depends on (the Online Shop uses Stripe because its API does).
 */
export function dependenciesOf(
  model: ProjectModel,
  id: string,
  options: { rollup?: boolean } = {},
): Dependency[] {
  const self = new Set([id, ...(options.rollup ? descendantsOf(model, id) : [])]);
  return model.relationships
    .filter((r) => self.has(r.sourceId) && !self.has(r.targetId))
    .map((r) => ({
      relationship: r,
      componentId: r.targetId,
      via: r.sourceId === id ? null : r.sourceId,
    }));
}

/** What depends on a component (or, with `rollup`, on anything inside it). */
export function dependentsOf(
  model: ProjectModel,
  id: string,
  options: { rollup?: boolean } = {},
): Dependency[] {
  const self = new Set([id, ...(options.rollup ? descendantsOf(model, id) : [])]);
  return model.relationships
    .filter((r) => self.has(r.targetId) && !self.has(r.sourceId))
    .map((r) => ({
      relationship: r,
      componentId: r.sourceId,
      via: r.targetId === id ? null : r.targetId,
    }));
}

/**
 * Relationships between components that are both on a diagram but aren't
 * drawn there ("known connections not drawn here").
 */
export function undrawnOn(model: ProjectModel, diagramId: string): ModelRelationship[] {
  const here = new Set(
    model.components
      .filter((c) => c.appearances.some((a) => a.diagramId === diagramId))
      .map((c) => c.id),
  );
  return model.relationships.filter(
    (r) =>
      here.has(r.sourceId) &&
      here.has(r.targetId) &&
      !r.drawn.some((d) => d.diagramId === diagramId),
  );
}

/**
 * Components with the same name that aren't the same component — offered
 * for linking (e.g. "Postgres" drawn separately on two diagrams).
 */
export function possibleDuplicates(model: ProjectModel): ModelComponent[][] {
  const byName = new Map<string, ModelComponent[]>();
  for (const c of model.components) {
    const key = c.name.trim().toLowerCase();
    if (!key || key === 'unnamed') continue;
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }
  return Array.from(byName.values()).filter((group) => {
    if (group.length < 2) return false;
    // Two components on the same diagram are deliberately different
    const diagramsSeen = new Set<string>();
    for (const c of group) {
      for (const a of c.appearances) {
        if (diagramsSeen.has(a.diagramId)) return false;
      }
      for (const a of c.appearances) diagramsSeen.add(a.diagramId);
    }
    return true;
  });
}

// ── Renaming ─────────────────────────────────────────────────

export interface RenameEdits {
  /** Label changes, one per appearance (the portal itself, or a shape's bound text). */
  elements: Array<{ id: string; diagramId: string; changes: { label: string } | { text: string } }>;
  /** Detail diagrams whose title follows the component's name. */
  diagrams: Array<{ id: string; title: string }>;
}

/**
 * What renaming a component touches: the label of every appearance on every
 * diagram, and the title of the diagram it opens into. Labels that already
 * read `name` are left alone (no needless version bumps).
 */
export function renameEdits(
  scene: Pick<MavisDrawScene, 'diagrams' | 'elements'>,
  componentId: string,
  name: string,
): RenameEdits {
  const live = scene.elements.filter((el) => !el.isDeleted);
  const byId = new Map(live.map((el) => [el.id, el]));
  const out: RenameEdits = { elements: [], diagrams: [] };
  const titled = new Set<string>();
  for (const el of live) {
    if (componentKeyOf(el, byId) !== componentId) continue;
    if (el.type === 'portal') {
      const portal = el as PortalElement;
      if (portal.label !== name) {
        out.elements.push({ id: el.id, diagramId: el.diagramId, changes: { label: name } });
      }
      const target = scene.diagrams.find((d) => d.id === portal.targetDiagramId);
      if (target && target.title !== name && !titled.has(target.id)) {
        titled.add(target.id);
        out.diagrams.push({ id: target.id, title: name });
      }
      continue;
    }
    const label = el.boundElements
      .filter((b) => b.type === 'text')
      .map((b) => byId.get(b.id))
      .find((t) => t?.type === 'text');
    if (label && (label as { text: string }).text !== name) {
      out.elements.push({ id: label.id, diagramId: label.diagramId, changes: { text: name } });
    }
  }
  return out;
}
