/**
 * Parser for Mermaid flowcharts (`graph` / `flowchart`).
 *
 * Covers what people actually write in READMEs and design docs: node shapes,
 * labelled/dotted/thick/bidirectional links, chains (`a --> b --> c`),
 * `&` fan-out, nested `subgraph … end` blocks, and comments. Styling
 * statements (`classDef`, `style`, `linkStyle`, `click`, `class`) are
 * accepted and ignored.
 */

export type MermaidDirection = 'TB' | 'BT' | 'LR' | 'RL';

export type MermaidShape =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'diamond'
  | 'hexagon'
  | 'asymmetric'
  | 'parallelogram';

export interface MermaidNode {
  id: string;
  label: string;
  shape: MermaidShape;
  /** Innermost subgraph the node belongs to, or null for the top level. */
  subgraph: string | null;
}

export interface MermaidEdge {
  from: string;
  to: string;
  label: string | null;
  style: 'solid' | 'dotted' | 'thick';
  arrowStart: boolean;
  arrowEnd: boolean;
}

export interface MermaidSubgraph {
  id: string;
  title: string;
  parent: string | null;
  direction: MermaidDirection | null;
}

export interface MermaidGraph {
  direction: MermaidDirection;
  nodes: Map<string, MermaidNode>;
  edges: MermaidEdge[];
  /** In declaration order (parents before children). */
  subgraphs: Map<string, MermaidSubgraph>;
}

export class MermaidParseError extends Error {
  constructor(
    message: string,
    public line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = 'MermaidParseError';
  }
}

const HEADER_RE = /^(?:graph|flowchart)(?:\s+(TB|TD|BT|LR|RL))?\s*;?\s*$/i;
const IGNORED_RE = /^(classDef|class|style|linkStyle|click|accTitle|accDescr|%%)\b/;

/** Strip a ```mermaid fence and leading blank lines, if present. */
function unfence(text: string): string {
  const fenced = /```\s*mermaid\s*\n([\s\S]*?)```/i.exec(text);
  return (fenced ? fenced[1] : text).replace(/^\s*\n/, '');
}

/** Quick check used to decide whether pasted text should be imported as Mermaid. */
export function isMermaidFlowchart(text: string): boolean {
  const body = unfence(text);
  const first = body
    .split('\n')
    .map((l) => l.replace(/%%.*$/, '').trim())
    .find((l) => l.length > 0);
  return !!first && HEADER_RE.test(first);
}

function normalizeDirection(dir: string | undefined): MermaidDirection {
  const d = (dir ?? 'TB').toUpperCase();
  return d === 'TD' ? 'TB' : (d as MermaidDirection);
}

function cleanLabel(raw: string): string {
  let label = raw.trim();
  if (label.startsWith('"') && label.endsWith('"') && label.length >= 2) {
    label = label.slice(1, -1);
  }
  if (label.startsWith('`') && label.endsWith('`') && label.length >= 2) {
    label = label.slice(1, -1);
  }
  return label
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#quot;/g, '"')
    .replace(/#amp;/g, '&')
    .replace(/#lt;/g, '<')
    .replace(/#gt;/g, '>')
    .trim();
}

// Opening → closing delimiters, longest first so `([` wins over `(`
const SHAPES: { open: string; close: string; shape: MermaidShape }[] = [
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[/', close: '/]', shape: 'parallelogram' },
  { open: '[\\', close: '\\]', shape: 'parallelogram' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'round' },
  { open: '{', close: '}', shape: 'diamond' },
  { open: '>', close: ']', shape: 'asymmetric' },
];

const ID_RE = /^[A-Za-z0-9_À-￿]+(?:-(?![-.>=])[A-Za-z0-9_À-￿]+)*/;

interface NodeRef {
  id: string;
  label?: string;
  shape?: MermaidShape;
}

function parseNodeRef(input: string): { ref: NodeRef; rest: string } | null {
  const s = input.trimStart();
  const idMatch = ID_RE.exec(s);
  if (!idMatch) return null;
  const id = idMatch[0];
  let rest = s.slice(id.length);

  let label: string | undefined;
  let shape: MermaidShape | undefined;
  for (const d of SHAPES) {
    if (!rest.startsWith(d.open)) continue;
    let body = rest.slice(d.open.length);
    let end: number;
    const trimmed = body.trimStart();
    if (trimmed.startsWith('"')) {
      // Quoted label may contain delimiter characters
      const offset = body.length - trimmed.length;
      const closeQuote = trimmed.indexOf('"', 1);
      if (closeQuote < 0) return null;
      const afterQuote = offset + closeQuote + 1;
      end = body.indexOf(d.close, afterQuote);
    } else {
      end = body.indexOf(d.close);
    }
    if (end < 0) return null;
    label = cleanLabel(body.slice(0, end));
    shape = d.shape;
    body = body.slice(end + d.close.length);
    rest = body;
    break;
  }

  // Inline class assignment: A:::important
  rest = rest.replace(/^:::[\w-]+/, '');
  return { ref: { id, label, shape }, rest };
}

function parseNodeGroup(input: string): { refs: NodeRef[]; rest: string } | null {
  const first = parseNodeRef(input);
  if (!first) return null;
  const refs = [first.ref];
  let rest = first.rest;
  for (;;) {
    const m = /^\s*&\s*/.exec(rest);
    if (!m) break;
    const next = parseNodeRef(rest.slice(m[0].length));
    if (!next) break;
    refs.push(next.ref);
    rest = next.rest;
  }
  return { refs, rest };
}

interface EdgeOp {
  style: MermaidEdge['style'];
  arrowStart: boolean;
  arrowEnd: boolean;
  label: string | null;
  rest: string;
}

function styleOf(body: string): MermaidEdge['style'] {
  if (body.includes('=')) return 'thick';
  if (body.includes('.')) return 'dotted';
  return 'solid';
}

function parseEdgeOp(input: string): EdgeOp | null {
  const s = input.trimStart();

  // Text in the middle: A -- text --> B, A -. text .-> B, A == text ==> B
  const mid = /^(<)?(--|==|-\.)\s+([^|>]+?)\s+(-{2,}|={2,}|\.-+)(>|o|x)?(?=\s|[A-Za-z0-9_"(]|$)/.exec(s);
  if (mid) {
    return {
      style: styleOf(mid[2] + mid[4]),
      arrowStart: !!mid[1],
      arrowEnd: mid[5] === '>',
      label: cleanLabel(mid[3]),
      rest: s.slice(mid[0].length),
    };
  }

  // Plain link, optionally with |text|
  const plain = /^(<|o|x)?(-{2,}|={2,}|-\.+-)(>|o|x)?(?:\s*\|([^|]*)\|)?/.exec(s);
  if (plain) {
    return {
      style: styleOf(plain[2]),
      arrowStart: plain[1] === '<',
      arrowEnd: plain[3] === '>',
      label: plain[4] !== undefined ? cleanLabel(plain[4]) || null : null,
      rest: s.slice(plain[0].length),
    };
  }
  return null;
}

/** Split a line into statements on `;` outside quotes and brackets. */
function splitStatements(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = '';
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote) {
      if ('[({'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) {
        out.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

function slug(title: string): string {
  return title.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'subgraph';
}

export function parseMermaidFlowchart(text: string): MermaidGraph {
  const lines = unfence(text).split('\n');
  const graph: MermaidGraph = {
    direction: 'TB',
    nodes: new Map(),
    edges: [],
    subgraphs: new Map(),
  };
  const stack: string[] = [];
  let sawHeader = false;

  const touch = (ref: NodeRef) => {
    const current = stack.length > 0 ? stack[stack.length - 1] : null;
    // An edge endpoint can name a subgraph; that's not a node
    if (graph.subgraphs.has(ref.id) && !ref.label) return;
    const existing = graph.nodes.get(ref.id);
    if (!existing) {
      graph.nodes.set(ref.id, {
        id: ref.id,
        label: ref.label ?? ref.id,
        shape: ref.shape ?? 'rect',
        subgraph: current,
      });
      return;
    }
    if (ref.label !== undefined) existing.label = ref.label;
    if (ref.shape !== undefined) existing.shape = ref.shape;
    // First subgraph a node appears in claims it
    if (existing.subgraph === null && current !== null) existing.subgraph = current;
  };

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.replace(/%%.*$/, '').trim();
    if (!line) return;

    if (!sawHeader) {
      const header = HEADER_RE.exec(line);
      if (!header) throw new MermaidParseError('Expected "graph" or "flowchart" header', lineNo);
      graph.direction = normalizeDirection(header[1]);
      sawHeader = true;
      return;
    }

    for (const statement of splitStatements(line)) {
      if (IGNORED_RE.test(statement)) continue;

      const sub = /^subgraph\s+(.+)$/i.exec(statement);
      if (sub) {
        const spec = sub[1].trim();
        let id: string;
        let title: string;
        const withTitle = /^([A-Za-z0-9_-]+)\s*\[(.+)\]$/.exec(spec);
        if (withTitle) {
          id = withTitle[1];
          title = cleanLabel(withTitle[2]);
        } else if (spec.startsWith('"')) {
          title = cleanLabel(spec);
          id = slug(title);
        } else {
          title = spec;
          id = /^[A-Za-z0-9_-]+$/.test(spec) ? spec : slug(spec);
        }
        let uniqueId = id;
        for (let n = 2; graph.subgraphs.has(uniqueId); n++) uniqueId = `${id}_${n}`;
        graph.subgraphs.set(uniqueId, {
          id: uniqueId,
          title,
          parent: stack.length > 0 ? stack[stack.length - 1] : null,
          direction: null,
        });
        stack.push(uniqueId);
        continue;
      }

      if (/^end$/i.test(statement)) {
        if (stack.length === 0) throw new MermaidParseError('"end" without "subgraph"', lineNo);
        stack.pop();
        continue;
      }

      const dir = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(statement);
      if (dir) {
        const current = stack[stack.length - 1];
        if (current) graph.subgraphs.get(current)!.direction = normalizeDirection(dir[1]);
        else graph.direction = normalizeDirection(dir[1]);
        continue;
      }

      // Node declaration or a chain of links
      let group = parseNodeGroup(statement);
      if (!group) throw new MermaidParseError(`Can't read "${statement}"`, lineNo);
      group.refs.forEach(touch);
      let rest = group.rest;

      while (rest.trim().length > 0) {
        const op = parseEdgeOp(rest);
        if (!op) throw new MermaidParseError(`Unexpected "${rest.trim()}"`, lineNo);
        const next = parseNodeGroup(op.rest);
        if (!next) throw new MermaidParseError(`Missing node after link in "${statement}"`, lineNo);
        next.refs.forEach(touch);
        for (const from of group.refs) {
          for (const to of next.refs) {
            graph.edges.push({
              from: from.id,
              to: to.id,
              label: op.label,
              style: op.style,
              arrowStart: op.arrowStart,
              arrowEnd: op.arrowEnd,
            });
          }
        }
        group = next;
        rest = next.rest;
      }
    }
  });

  if (!sawHeader) throw new MermaidParseError('Empty diagram', 1);
  if (stack.length > 0) throw new MermaidParseError(`Unclosed subgraph "${stack[stack.length - 1]}"`, lines.length);
  return graph;
}
