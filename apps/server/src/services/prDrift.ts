import {
  analyzeRepo,
  describeDrift,
  diffModels,
  isManifest,
  isRelevantPath,
  type DriftChange,
} from '@mavisdraw/compat/repo';
import type { MavisDrawScene } from '@mavisdraw/types';
import { componentForPath, indexComponents, type ComponentInfo } from '@mavisdraw/llm';
import { buildProposal, type BuiltProposal, type ProposalRequest } from './proposalInput.js';

/**
 * What a pull request does to the architecture, and what that means for a
 * map of the repository: which components its files belong to, and the
 * structural changes (new packages, new dependencies on services…) the map
 * doesn't show yet, as a proposal to review. Pure: GitHub and the database
 * are the caller's business.
 */

export interface PrFileChange {
  filename: string;
  status: string;
  previous_filename?: string;
}

/** The file list at the PR's head, from the base tree and the PR's changes. */
export function headFiles(baseFiles: string[], changes: PrFileChange[]): string[] {
  const files = new Set(baseFiles);
  for (const c of changes) {
    if (c.status === 'removed') files.delete(c.filename);
    else {
      if (c.status === 'renamed' && c.previous_filename) files.delete(c.previous_filename);
      files.add(c.filename);
    }
  }
  return Array.from(files);
}

/** Does the PR change anything the repository analyzer looks at? */
export function affectsStructure(changes: PrFileChange[]): boolean {
  return changes.some(
    (c) =>
      isManifest(c.filename) ||
      (c.status !== 'modified' && c.status !== 'changed' && isRelevantPath(c.filename)),
  );
}

/** Manifests to read at the base, and the ones the PR changed (read at the head too). */
export function manifestsToRead(
  baseFiles: string[],
  changes: PrFileChange[],
  limit = 80,
): { base: string[]; changed: string[] } {
  const isAnalyzed = (f: string) => isManifest(f) && isRelevantPath(f);
  const changed = changes
    .filter((c) => c.status !== 'removed' && isAnalyzed(c.filename))
    .map((c) => c.filename);
  return { base: baseFiles.filter(isAnalyzed).slice(0, limit), changed: changed.slice(0, limit) };
}

/** Architecture changes between the PR's base and head. */
export function architectureDrift(input: {
  repoName: string;
  baseFiles: string[];
  changes: PrFileChange[];
  base: Map<string, string>;
  head: Map<string, string>;
}): DriftChange[] {
  const removed = new Set(
    input.changes.filter((c) => c.status === 'removed').map((c) => c.filename),
  );
  const before = analyzeRepo({
    name: input.repoName,
    files: input.baseFiles,
    read: (p) => input.base.get(p),
  });
  const after = analyzeRepo({
    name: input.repoName,
    files: headFiles(input.baseFiles, input.changes),
    // Unchanged manifests read the same at both ends
    read: (p) => (removed.has(p) ? undefined : (input.head.get(p) ?? input.base.get(p))),
  });
  return diffModels(before, after);
}

export interface ProjectImpact {
  project: { id: string; name: string };
  /** Components that own the PR's files (most-touched first). */
  touched: Array<{ component: ComponentInfo; files: number }>;
  /** Changed files no component on the map stands for. */
  unmapped: number;
  /**
   * Architecture changes, and whether the map already reflects each (an
   * addition is drawn, a removal is gone from the map).
   */
  changes: Array<{ text: string; removal: boolean; onMap: boolean }>;
  /** A map update for a person to review, when the map is behind. */
  proposal: { diagramId: string; built: BuiltProposal } | null;
}

const key = (s: string) => s.trim().toLowerCase();
const codeKey = (path: string) =>
  path === '.' ? '' : path.replace(/^\/+|\/+$/g, '').toLowerCase();

/** The diagram most of the code-linked components live on (the map's "code" level). */
function codeLevel(components: ComponentInfo[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const c of components) {
    if (c.code) counts.set(c.diagramId, (counts.get(c.diagramId) ?? 0) + 1);
  }
  let best = fallback;
  let most = 0;
  for (const [id, n] of counts) {
    if (n > most) {
      best = id;
      most = n;
    }
  }
  return best;
}

export function impactOnProject(input: {
  project: { id: string; name: string };
  scene: MavisDrawScene;
  changes: PrFileChange[];
  drift: DriftChange[];
  pr: { repo: string; number: number; title: string };
}): ProjectImpact {
  const components = indexComponents(input.scene);
  const byCode = new Map<string, ComponentInfo>();
  for (const c of components) {
    if (c.code && !byCode.has(codeKey(c.code.path))) byCode.set(codeKey(c.code.path), c);
  }
  const byLabel = new Map<string, ComponentInfo>();
  for (const c of components) if (!byLabel.has(key(c.label))) byLabel.set(key(c.label), c);
  const find = (repoComponent: { path: string; name: string }) =>
    byCode.get(codeKey(repoComponent.path)) ?? byLabel.get(key(repoComponent.name));

  // ── Which components the files belong to
  const counts = new Map<ComponentInfo, number>();
  let unmapped = 0;
  for (const change of input.changes) {
    const owner =
      componentForPath(components, change.filename) ??
      (change.previous_filename ? componentForPath(components, change.previous_filename) : null);
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    else unmapped++;
  }
  const touched = Array.from(counts, ([component, files]) => ({ component, files })).sort(
    (a, b) => b.files - a.files || a.component.label.localeCompare(b.component.label),
  );

  // ── Architecture changes, against the map
  const level = codeLevel(components, input.scene.rootDiagramId);
  const onLevel = (c: ComponentInfo | undefined) => !!c && c.diagramId === level;
  const connected = (a: ComponentInfo, b: ComponentInfo) =>
    a.outgoing.some((o) => key(o.to) === key(b.label));
  const request: Required<Pick<ProposalRequest, 'add' | 'connect' | 'remove'>> = {
    add: [],
    connect: [],
    remove: [],
  };
  const adding = new Set<string>();
  const add = (name: string, kind: 'component' | 'datastore' | 'system', codePath?: string) => {
    if (adding.has(key(name))) return;
    adding.add(key(name));
    request.add.push(codePath !== undefined ? { name, kind, codePath } : { name, kind });
  };
  const connect = (from: string, to: string) => {
    if (!request.connect.some((c) => key(c.from) === key(from) && key(c.to) === key(to))) {
      request.connect.push({ from, to });
    }
  };

  const changes = input.drift.map((d) => {
    const text = describeDrift(d);
    const removal = d.kind.endsWith('-removed');
    switch (d.kind) {
      case 'component-added': {
        const existing = find(d.component);
        if (!existing)
          add(d.component.name, 'system', d.component.path === '.' ? '' : d.component.path);
        return { text, removal, onMap: !!existing };
      }
      case 'component-removed': {
        const existing = find(d.component);
        if (existing && onLevel(existing)) request.remove.push({ component: existing.label });
        return { text, removal, onMap: !existing };
      }
      case 'dependency-added': {
        const from = find(d.from);
        const to = find(d.to);
        const onMap = !!from && !!to && connected(from, to);
        if (!onMap && onLevel(from) && (onLevel(to) || adding.has(key(d.to.name)))) {
          connect(from!.label, to?.label ?? d.to.name);
        }
        return { text, removal, onMap };
      }
      case 'resource-added': {
        const from = find(d.from);
        const resource = byLabel.get(key(d.resource.name));
        const onMap = !!from && !!resource && connected(from, resource);
        if (!onMap && onLevel(from)) {
          if (!resource)
            add(d.resource.name, d.resource.kind === 'external' ? 'component' : 'datastore');
          if (!resource || onLevel(resource))
            connect(from!.label, resource?.label ?? d.resource.name);
        }
        return { text, removal, onMap };
      }
      case 'dependency-removed': {
        const from = find(d.from);
        const to = find(d.to);
        return { text, removal, onMap: !(from && to && connected(from, to)) };
      }
      case 'resource-removed': {
        const from = find(d.from);
        const resource = byLabel.get(key(d.resource.name));
        return { text, removal, onMap: !(from && resource && connected(from, resource)) };
      }
    }
  });

  let proposal: ProjectImpact['proposal'] = null;
  if (request.add.length + request.connect.length + request.remove.length > 0) {
    const built = buildProposal(
      {
        description: `${input.pr.repo}#${input.pr.number} “${input.pr.title}” changes the architecture`,
        ...request,
      },
      components.filter((c) => c.diagramId === level),
    );
    if (built.ok) proposal = { diagramId: level, built: built.proposal };
  }

  return { project: input.project, touched, unmapped, changes, proposal };
}

/** Marks the one comment the app keeps up to date on each PR. */
export const COMMENT_MARKER = '<!-- mavisdraw:pr-map -->';

/** Whether there's anything worth a comment. */
export const hasNews = (impacts: ProjectImpact[]) =>
  impacts.some((i) => i.touched.length > 0 || i.changes.length > 0);

const MAX_ROWS = 8;

/**
 * Text from maps and repositories, safe to put in a comment: it can't add
 * links (markdown, HTML or bare URLs GitHub would auto-link), images,
 * emphasis or table cells, and can't @mention anyone. One line, bounded.
 * It's always placed mid-line, so line-start markup (#, -, >) can't apply.
 */
export function mdText(value: string, max = 200): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  const clipped = oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
  return (
    clipped
      .replace(/[\\`*_[\]|~]/g, (c) => `\\${c}`)
      .replace(/</g, '&lt;')
      // Zero-width spaces: "@team" notifies no one, and URLs aren't auto-linked
      .replace(/@/g, '@\u200b')
      .replace(/:\/\//g, ':\u200b//')
      .replace(/www\./gi, (w) => `${w.slice(0, 3)}\u200b.`)
  );
}

/** A diagram id or project id as part of a link (they are nanoids). */
const idPart = (id: string) => encodeURIComponent(id);

const MAX_PROJECTS = 5;
const MAX_CHANGES = 20;
/** GitHub rejects comments over 65,536 characters. */
const MAX_COMMENT_CHARS = 60_000;

export function renderPrComment(input: {
  impacts: ProjectImpact[];
  headSha: string;
  appUrl: string;
  /** Proposal ids by project id. */
  proposals: Map<string, string>;
}): string {
  const lines = [COMMENT_MARKER, '### 🗺️ MavisDraw architecture map', ''];
  if (!hasNews(input.impacts)) {
    lines.push('This pull request no longer touches the mapped architecture.');
  }
  const shown = input.impacts.filter((i) => i.touched.length > 0 || i.changes.length > 0);
  for (const impact of shown.slice(0, MAX_PROJECTS)) {
    const link = `${input.appUrl}/p/${idPart(impact.project.id)}`;
    if (input.impacts.length > 1)
      lines.push(`#### [${mdText(impact.project.name, 100)}](${link})`, '');
    if (impact.touched.length > 0) {
      const names = impact.touched.slice(0, 3).map((t) => `**${mdText(t.component.label, 80)}**`);
      const more = impact.touched.length > 3 ? ` and ${impact.touched.length - 3} more` : '';
      lines.push(`Touches ${names.join(', ')}${more}.`, '');
      lines.push('| Component | Where on the map | Files |', '| --- | --- | ---: |');
      for (const t of impact.touched.slice(0, MAX_ROWS)) {
        const where = t.component.path.map((p) => mdText(p, 60)).join(' › ');
        lines.push(
          `| [${mdText(t.component.label, 80)}](${link}/d/${idPart(t.component.diagramId)}) | ${where} | ${t.files} |`,
        );
      }
      if (impact.unmapped > 0) lines.push(`| _not on the map_ | | ${impact.unmapped} |`);
      lines.push('');
    }
    if (impact.changes.length > 0) {
      lines.push('**Architecture changes**', '');
      for (const c of impact.changes.slice(0, MAX_CHANGES)) {
        const note = c.onMap ? '' : c.removal ? ' — _still on the map_' : ' — _not on the map yet_';
        lines.push(`- ${mdText(c.text, 300)}${note}`);
      }
      if (impact.changes.length > MAX_CHANGES) {
        lines.push(`- …and ${impact.changes.length - MAX_CHANGES} more`);
      }
      lines.push('');
    }
    const proposalId = input.proposals.get(impact.project.id);
    if (proposalId) {
      lines.push(
        `**[Review the proposed map update →](${link}?proposals=open)** Someone with edit access applies it in one click.`,
        '',
      );
    } else if (input.impacts.length === 1) {
      lines.push(`[Open the map](${link})`, '');
    }
  }
  if (shown.length > MAX_PROJECTS) {
    lines.push(`…and ${shown.length - MAX_PROJECTS} more maps of this repository.`, '');
  }
  lines.push(`<sub>Updated for ${mdText(input.headSha.slice(0, 7))}</sub>`);
  const body = lines.join('\n');
  return body.length > MAX_COMMENT_CHARS
    ? `${body.slice(0, MAX_COMMENT_CHARS)}\n\n…(shortened)`
    : body;
}
