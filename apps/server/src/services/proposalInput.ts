import type { ComponentInfo } from '@mavisdraw/llm';
import type { ProposedChange, ProposedConnection } from '@mavisdraw/types';

/**
 * What a coding agent asks for, in the terms it sees in read_architecture
 * (names, not ids), turned into the proposal format the editor applies
 * (the same one the in-app AI assistant produces).
 */
export type ComponentKind = 'component' | 'datastore' | 'system';

export interface ProposalRequest {
  description: string;
  /** `codePath`: the repository folder a new system stands for (PR checks know it). */
  add?: Array<{ name: string; kind?: ComponentKind; codePath?: string }>;
  connect?: Array<{ from: string; to: string; label?: string }>;
  rename?: Array<{ component: string; to: string }>;
  remove?: Array<{ component: string }>;
}

export interface BuiltProposal {
  description: string;
  changes: ProposedChange[];
  connections: ProposedConnection[];
}

/** How each kind is drawn: datastores as cylinders-ish ellipses, systems as drillable portals. */
const ELEMENT_TYPE: Record<ComponentKind, string> = {
  component: 'rectangle',
  datastore: 'ellipse',
  system: 'portal',
};

export const PROPOSAL_LIMITS = {
  add: 30,
  connect: 60,
  rename: 30,
  remove: 30,
  name: 100,
  description: 1000,
} as const;

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Build a proposal against the components of one diagram, or explain what's
 * wrong in terms the agent can act on (which names exist).
 */
export function buildProposal(
  request: ProposalRequest,
  components: ComponentInfo[],
): { ok: true; proposal: BuiltProposal } | { ok: false; error: string } {
  const add = request.add ?? [];
  const connect = request.connect ?? [];
  const rename = request.rename ?? [];
  const remove = request.remove ?? [];
  if (add.length + connect.length + rename.length + remove.length === 0) {
    return {
      ok: false,
      error: 'Nothing to propose: give at least one of add, connect, rename or remove.',
    };
  }

  const existing = new Map<string, ComponentInfo>();
  for (const c of components) {
    existing.set(c.elementId, c);
    if (!existing.has(key(c.label))) existing.set(key(c.label), c);
  }
  const find = (ref: string) => existing.get(ref) ?? existing.get(key(ref));
  const available = () => {
    const names = components.map((c) => `"${c.label}"`);
    if (names.length === 0) return 'This diagram has no named components yet.';
    const shown = names.slice(0, 40).join(', ');
    return `Components in this diagram: ${shown}${names.length > 40 ? ', …' : ''}.`;
  };

  const errors: string[] = [];
  const changes: ProposedChange[] = [];
  /** Normalized name → the name as given in "add". */
  const added = new Map<string, string>();

  for (const a of add) {
    const name = a.name.trim();
    if (!name) {
      errors.push('A component to add has an empty name.');
      continue;
    }
    if (find(name)) {
      errors.push(`"${name}" is already on this diagram; connect to it instead of adding it.`);
      continue;
    }
    if (added.has(key(name))) continue;
    added.set(key(name), name);
    const change: ProposedChange = {
      action: 'add',
      elementType: ELEMENT_TYPE[a.kind ?? 'component'],
      label: name,
    };
    if (a.codePath) change.properties = { codePath: a.codePath };
    changes.push(change);
  }

  for (const r of rename) {
    const target = find(r.component);
    if (!target) {
      errors.push(`No component "${r.component}" to rename.`);
      continue;
    }
    changes.push({ action: 'modify', elementId: target.elementId, label: r.to.trim() });
  }

  for (const r of remove) {
    const target = find(r.component);
    if (!target) {
      errors.push(`No component "${r.component}" to remove.`);
      continue;
    }
    changes.push({ action: 'delete', elementId: target.elementId });
  }

  const resolveEnd = (ref: string): string | null => {
    const fresh = added.get(key(ref));
    if (fresh) return fresh;
    const c = find(ref);
    return c ? c.label : null;
  };
  const connections: ProposedConnection[] = [];
  for (const c of connect) {
    const from = resolveEnd(c.from);
    const to = resolveEnd(c.to);
    if (!from) errors.push(`Can't connect from "${c.from}": it isn't on this diagram or in "add".`);
    if (!to) errors.push(`Can't connect to "${c.to}": it isn't on this diagram or in "add".`);
    if (!from || !to) continue;
    if (key(from) === key(to)) {
      errors.push(`"${from}" can't connect to itself.`);
      continue;
    }
    const label = c.label?.trim();
    connections.push(
      label ? { fromLabel: from, toLabel: to, label } : { fromLabel: from, toLabel: to },
    );
  }

  if (errors.length > 0) {
    const missingName = errors.some(
      (e) => e.startsWith('No component') || e.startsWith("Can't connect"),
    );
    return { ok: false, error: [...errors, ...(missingName ? [available()] : [])].join('\n') };
  }
  return {
    ok: true,
    proposal: { description: request.description.trim(), changes, connections },
  };
}
