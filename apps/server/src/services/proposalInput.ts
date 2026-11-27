import type { ComponentInfo } from '@mavisdraw/llm';
import type {
  ModelComponent,
  ProjectModel,
  ProposedChange,
  ProposedChangeAdd,
  ProposedConnection,
} from '@mavisdraw/types';

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
 *
 * With the project's `model`, names and component ids can also refer to
 * components drawn on other diagrams: adding one shows it here (another
 * appearance, not a duplicate), and connecting to one records the
 * relationship in the model, since there's no shape here to draw an arrow to.
 */
export function buildProposal(
  request: ProposalRequest,
  components: ComponentInfo[],
  model?: ProjectModel,
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
  const findHere = (ref: string) => existing.get(ref) ?? existing.get(key(ref));
  // A model component by id, or by a name only one component has
  const inModel = (ref: string): ModelComponent | undefined => {
    if (!model) return undefined;
    const byId = model.components.find((c) => c.id === ref.trim());
    if (byId) return byId;
    const named = model.components.filter((c) => key(c.name) === key(ref));
    return named.length === 1 ? named[0] : undefined;
  };
  // Its shape on this diagram, if it's drawn here
  const hereOf = (mc: ModelComponent) =>
    components.find((c) => mc.appearances.some((a) => a.elementId === c.elementId));
  const find = (ref: string) => {
    const here = findHere(ref);
    if (here) return here;
    const mc = inModel(ref);
    return mc ? hereOf(mc) : undefined;
  };
  /** A component drawn only on other diagrams (or recorded, not drawn). */
  const elsewhere = (ref: string) => {
    const mc = inModel(ref);
    return mc && !hereOf(mc) ? mc : undefined;
  };
  const componentIdOf = (c: ComponentInfo) =>
    model?.components.find((m) => m.appearances.some((a) => a.elementId === c.elementId))?.id;
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
    const other = elsewhere(name);
    const label = other ? other.name : name;
    if (added.has(key(label))) continue;
    added.set(key(label), label);
    if (other) added.set(key(name), label);
    const change: ProposedChangeAdd = {
      action: 'add',
      elementType: other
        ? other.detailDiagramId
          ? 'portal'
          : ELEMENT_TYPE[other.kind === 'datastore' ? 'datastore' : 'component']
        : ELEMENT_TYPE[a.kind ?? 'component'],
      label,
    };
    if (other) {
      // The same component, shown here too
      change.componentId = other.id;
      if (other.appearances[0]) change.drawnOn = other.appearances[0].path.join(' › ');
      if (other.detailDiagramId) change.detailDiagramId = other.detailDiagramId;
    }
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

  /** An end: its label here, or (drawn elsewhere) its name and component id. */
  const resolveEnd = (ref: string): { label: string; componentId?: string } | null => {
    const fresh = added.get(key(ref));
    if (fresh) return { label: fresh };
    const c = find(ref);
    if (c) return { label: c.label };
    const other = elsewhere(ref);
    return other ? { label: other.name, componentId: other.id } : null;
  };
  const nowhere = model
    ? 'it isn\'t on this diagram, in "add", or anywhere in the map'
    : 'it isn\'t on this diagram or in "add"';
  const connections: ProposedConnection[] = [];
  for (const c of connect) {
    const from = resolveEnd(c.from);
    const to = resolveEnd(c.to);
    if (!from) errors.push(`Can't connect from "${c.from}": ${nowhere}.`);
    if (!to) errors.push(`Can't connect to "${c.to}": ${nowhere}.`);
    if (!from || !to) continue;
    if (key(from.label) === key(to.label)) {
      errors.push(`"${from.label}" can't connect to itself.`);
      continue;
    }
    const conn: ProposedConnection = { fromLabel: from.label, toLabel: to.label };
    const label = c.label?.trim();
    if (label) conn.label = label;
    // Drawn elsewhere: recorded in the model, so both ends need their ids
    if (from.componentId || to.componentId) {
      const here = (end: { label: string; componentId?: string }) => {
        if (end.componentId) return end.componentId;
        const shape = findHere(end.label);
        return shape ? componentIdOf(shape) : undefined; // a new shape: known once applied
      };
      const fromId = here(from);
      const toId = here(to);
      if (fromId) conn.fromComponentId = fromId;
      if (toId) conn.toComponentId = toId;
    }
    connections.push(conn);
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
