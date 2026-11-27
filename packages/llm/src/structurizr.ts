import type { ModelComponent, ProjectModel } from '@mavisdraw/types';

/**
 * The project's model as a Structurizr DSL workspace (C4): top-level
 * components become people and software systems, what's inside a system
 * becomes its containers, and what's inside a container its components
 * (deeper levels fold into the container they're in, as C4 has three).
 * Relationships keep their description and technology; views are generated
 * for every level that has something inside it.
 */

type Level = 'person' | 'softwareSystem' | 'container' | 'component';

interface Placed {
  component: ModelComponent;
  level: Level;
  ident: string;
  children: Placed[];
}

/** A quoted DSL string: one line, quotes and backslashes escaped. */
function str(value: string | null | undefined): string {
  const clean = (value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function identifiers() {
  const used = new Set<string>();
  return (name: string): string => {
    let base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (!base) base = 'element';
    if (/^[0-9]/.test(base)) base = `e_${base}`;
    let ident = base;
    for (let n = 2; used.has(ident); n++) ident = `${base}_${n}`;
    used.add(ident);
    return ident;
  };
}

export interface StructurizrOptions {
  /** Workspace name (the project's). */
  name: string;
  description?: string;
}

export function toStructurizrDsl(model: ProjectModel, options: StructurizrOptions): string {
  const byId = new Map(model.components.map((c) => [c.id, c]));
  const childrenOf = new Map<string, ModelComponent[]>();
  const roots: ModelComponent[] = [];
  for (const c of model.components) {
    // People are always top-level in C4; a component sits in its first parent
    const parent = c.kind === 'person' ? undefined : c.parents.find((p) => byId.has(p));
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), c]);
    else roots.push(c);
  }

  const ident = identifiers();
  const placed = new Map<string, Placed>();
  const parentOf = new Map<string, Placed>();
  const place = (c: ModelComponent, level: Level, seen: Set<string>): Placed => {
    const node: Placed = { component: c, level, ident: ident(c.name), children: [] };
    placed.set(c.id, node);
    seen.add(c.id);
    const inside = level === 'softwareSystem' ? 'container' : 'component';
    // Deeper than components: fold into this element (C4 has three levels)
    const collect = (id: string): ModelComponent[] =>
      (childrenOf.get(id) ?? []).filter((k) => !seen.has(k.id));
    if (level === 'person') return node;
    if (level === 'component') return node;
    const queue = collect(c.id);
    while (queue.length > 0) {
      const k = queue.shift()!;
      if (seen.has(k.id)) continue;
      parentOf.set(k.id, node);
      node.children.push(place(k, inside, seen));
      if (inside === 'component') queue.push(...collect(k.id));
    }
    return node;
  };
  const seen = new Set<string>();
  const top = roots.map((c) => place(c, c.kind === 'person' ? 'person' : 'softwareSystem', seen));
  // Anything left (containment cycles): top-level systems
  for (const c of model.components) {
    if (!seen.has(c.id)) top.push(place(c, 'softwareSystem', seen));
  }

  const lines: string[] = [];
  const out = (depth: number, line: string) => lines.push(`${'    '.repeat(depth)}${line}`);

  const element = (node: Placed, depth: number) => {
    const c = node.component;
    const args = [str(c.name), str(c.description)];
    if (node.level === 'container' || node.level === 'component') args.push(str(c.technology));
    const tags = [
      ...(c.kind === 'external' ? ['External'] : []),
      ...(c.kind === 'datastore' ? ['Database'] : []),
      ...(c.kind === 'queue' ? ['Queue'] : []),
      ...c.tags,
    ];
    // Lines inside the element's block, each with its extra indent
    const body: Array<[number, string]> = [];
    if (tags.length > 0) body.push([0, `tags ${tags.map(str).join(' ')}`]);
    if (c.links[0]) body.push([0, `url ${str(c.links[0].url)}`]);
    if (c.owner) body.push([0, 'properties {'], [1, `"owner" ${str(c.owner)}`], [0, '}']);
    const open = node.children.length > 0 || body.length > 0;
    out(depth, `${node.ident} = ${node.level} ${args.join(' ')}${open ? ' {' : ''}`);
    for (const [extra, b] of body) out(depth + 1 + extra, b);
    for (const k of node.children) element(k, depth + 1);
    if (open) out(depth, '}');
  };

  out(
    0,
    `workspace ${str(options.name)} ${str(options.description ?? 'Exported from MavisDraw')} {`,
  );
  out(1, '!identifiers hierarchical');
  out(1, 'model {');
  for (const node of top) element(node, 2);

  // A relationship between an element and something inside it isn't allowed
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let c = byId.get(id); c; ) {
      const parent = c.parents.find((p) => byId.has(p) && !out.has(p));
      if (!parent) break;
      out.add(parent);
      c = byId.get(parent);
    }
    return out;
  };
  /** Hierarchical identifier: system.container.component */
  const pathOf = (id: string): string => {
    const chain: string[] = [];
    for (let node = placed.get(id); node; node = parentOf.get(node.component.id)) {
      chain.unshift(node.ident);
    }
    return chain.join('.');
  };
  for (const r of model.relationships) {
    if (!placed.has(r.sourceId) || !placed.has(r.targetId)) continue;
    if (ancestors(r.sourceId).has(r.targetId) || ancestors(r.targetId).has(r.sourceId)) continue;
    const description = r.description ?? r.labels[0] ?? 'Uses';
    const args = [str(description), ...(r.technology ? [str(r.technology)] : [])];
    out(2, `${pathOf(r.sourceId)} -> ${pathOf(r.targetId)} ${args.join(' ')}`);
  }
  out(1, '}');

  out(1, 'views {');
  out(2, 'systemLandscape "Landscape" {');
  out(3, 'include *');
  out(3, 'autoLayout');
  out(2, '}');
  const view = (kind: string, node: Placed, key: string) => {
    out(2, `${kind} ${pathOf(node.component.id)} ${str(key)} {`);
    out(3, 'include *');
    out(3, 'autoLayout');
    out(2, '}');
  };
  for (const node of top) {
    if (node.level !== 'softwareSystem' || node.component.kind === 'external') continue;
    view('systemContext', node, `${node.ident}-context`);
    if (node.children.length > 0) view('container', node, `${node.ident}-containers`);
    for (const k of node.children) {
      if (k.children.length > 0) view('component', k, `${node.ident}-${k.ident}-components`);
    }
  }
  out(2, 'styles {');
  out(3, 'element "Person" {');
  out(4, 'shape Person');
  out(3, '}');
  out(3, 'element "External" {');
  out(4, 'background #8a8a8a');
  out(4, 'color #ffffff');
  out(3, '}');
  out(3, 'element "Database" {');
  out(4, 'shape Cylinder');
  out(3, '}');
  out(3, 'element "Queue" {');
  out(4, 'shape Pipe');
  out(3, '}');
  out(2, '}');
  out(1, '}');
  out(0, '}');
  return `${lines.join('\n')}\n`;
}
