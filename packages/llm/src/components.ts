import type {
  Diagram,
  LinearElement,
  MavisDrawScene,
  MavisElement,
  PortalElement,
} from '@mavisdraw/types';
import { getBoundText, getGivenLabel } from './labels.js';

/**
 * A named thing on the map (a service, datastore, nested system…), with
 * where it sits in the nested map, the code it stands for and what it's
 * wired to. Coding agents look these up ("which component owns
 * apps/server/src/auth.ts?"), and PR checks map changed files onto them.
 */
export interface ComponentInfo {
  elementId: string;
  diagramId: string;
  /** Diagram titles from the top-level map down to the one it's on. */
  path: string[];
  label: string;
  type: string;
  /** The nested diagram it drills into (portals). */
  drillsInto?: { diagramId: string; title: string };
  /** The code it stands for: a folder in a repository. */
  code?: { repo?: string; path: string };
  outgoing: Array<{ to: string; label?: string }>;
  incoming: Array<{ from: string; label?: string }>;
}

/** Elements that are wiring or decoration, not components. */
const NOT_COMPONENTS = new Set(['text', 'arrow', 'line', 'freedraw', 'image']);

function codeOf(el: MavisElement): ComponentInfo['code'] {
  if (el.type !== 'portal') return undefined;
  const portal = el as PortalElement;
  const link = portal.githubLink;
  const path = (portal.codePath ?? link?.path ?? '').replace(/^\/+|\/+$/g, '');
  if (!path && !link) return undefined;
  return { repo: link ? `${link.owner}/${link.repo}` : undefined, path };
}

/** Every labelled component in a scene, across all nested diagrams. */
export function indexComponents(scene: MavisDrawScene): ComponentInfo[] {
  const diagrams = new Map<string, Diagram>(scene.diagrams.map((d) => [d.id, d]));
  const live = scene.elements.filter((el) => !el.isDeleted);
  const byId = new Map<string, MavisElement>(live.map((el) => [el.id, el]));

  const pathCache = new Map<string, string[]>();
  const pathOf = (diagramId: string, seen = new Set<string>()): string[] => {
    const cached = pathCache.get(diagramId);
    if (cached) return cached;
    const d = diagrams.get(diagramId);
    if (!d || seen.has(diagramId)) return [];
    seen.add(diagramId);
    const path = [...(d.parentDiagramId ? pathOf(d.parentDiagramId, seen) : []), d.title];
    pathCache.set(diagramId, path);
    return path;
  };

  const components = new Map<string, ComponentInfo>();
  for (const el of live) {
    if (NOT_COMPONENTS.has(el.type)) continue;
    const label = getGivenLabel(el, byId);
    if (!label) continue;
    const info: ComponentInfo = {
      elementId: el.id,
      diagramId: el.diagramId,
      path: pathOf(el.diagramId),
      label,
      type: el.type,
      outgoing: [],
      incoming: [],
    };
    if (el.type === 'portal') {
      const target = diagrams.get((el as PortalElement).targetDiagramId);
      if (target) info.drillsInto = { diagramId: target.id, title: target.title };
    }
    const code = codeOf(el);
    if (code) info.code = code;
    components.set(el.id, info);
  }

  for (const el of live) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const conn = el as LinearElement;
    const from = conn.startBinding ? components.get(conn.startBinding.elementId) : undefined;
    const to = conn.endBinding ? components.get(conn.endBinding.elementId) : undefined;
    if (!from || !to || from === to) continue;
    const label = getBoundText(conn, byId) ?? undefined;
    from.outgoing.push(label ? { to: to.label, label } : { to: to.label });
    to.incoming.push(label ? { from: from.label, label } : { from: from.label });
  }

  return Array.from(components.values());
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const trimSlashes = (s: string) => s.replace(/^\.?\/+|\/+$/g, '');

/** How well a component matches a name or a file path (0 = not at all). */
export function matchScore(component: ComponentInfo, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const label = normalize(component.label);
  let score = 0;
  if (label === q) score = 100;
  else if (label.startsWith(q)) score = 80;
  else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) score = 60;
  else if (label.includes(q)) score = 40;
  else {
    const words = q.split(' ');
    if (words.length > 1 && words.every((w) => label.includes(w))) score = 30;
  }

  // A file or folder inside the code a component stands for
  const codePath = component.code?.path;
  if (codePath && /[/.]/.test(q)) {
    const path = trimSlashes(q);
    const own = codePath.toLowerCase();
    if (path === own) score = Math.max(score, 95);
    else if (path.startsWith(`${own}/`)) {
      // Deeper (more specific) folders win
      score = Math.max(score, 70 + Math.min(20, own.split('/').length * 4));
    }
  }
  return score;
}

/** Components best matching a name or file path, best first. */
export function searchComponents(
  components: ComponentInfo[],
  query: string,
  limit = 10,
): Array<ComponentInfo & { score: number }> {
  return components
    .map((c) => ({ ...c, score: matchScore(c, query) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, limit);
}

/**
 * The component that owns a file: the one whose code folder is the deepest
 * prefix of the path. Null when no component covers it.
 */
export function componentForPath(
  components: ComponentInfo[],
  filePath: string,
): ComponentInfo | null {
  const path = trimSlashes(filePath).toLowerCase();
  let best: ComponentInfo | null = null;
  let bestDepth = -1;
  for (const c of components) {
    const own = c.code?.path?.toLowerCase();
    if (own === undefined) continue;
    // An empty path is the repository root: it covers everything, weakly
    const covers = own === '' || path === own || path.startsWith(`${own}/`);
    if (!covers) continue;
    const depth = own === '' ? 0 : own.split('/').length;
    if (depth > bestDepth) {
      best = c;
      bestDepth = depth;
    }
  }
  return best;
}

/** One line per component, for people and agents to read. */
export function describeComponent(c: ComponentInfo): string {
  const lines = [`**${c.label}** (${c.type}) — in ${c.path.join(' › ') || 'the map'}`];
  if (c.drillsInto) lines.push(`  - drills into "${c.drillsInto.title}"`);
  if (c.code) {
    const where = c.code.path || '(repository root)';
    lines.push(`  - code: ${c.code.repo ? `${c.code.repo} @ ` : ''}${where}`);
  }
  if (c.outgoing.length > 0) {
    lines.push(
      `  - connects to: ${c.outgoing.map((o) => `"${o.to}"${o.label ? ` (${o.label})` : ''}`).join(', ')}`,
    );
  }
  if (c.incoming.length > 0) {
    lines.push(
      `  - used by: ${c.incoming.map((i) => `"${i.from}"${i.label ? ` (${i.label})` : ''}`).join(', ')}`,
    );
  }
  lines.push(`  - ids: diagram ${c.diagramId}, element ${c.elementId}`);
  return lines.join('\n');
}
