import type { Diagram } from '@mavisdraw/types';
import type {
  MavisElement,
  PortalElement,
  LinearElement,
  TextElement,
  GitHubLink,
} from '@mavisdraw/types';
import type { MavisDrawScene } from '@mavisdraw/types';

// ── Public API ──────────────────────────────────────────────

/**
 * Serialize a MavisDraw scene to LLM-readable structured Markdown.
 *
 * Topology-only: element names, types, connections, and GitHub links.
 * No coordinates, sizes, or styling information.
 */
export function serializeScene(scene: MavisDrawScene, projectName?: string): string {
  const { diagrams, elements, rootDiagramId } = scene;

  const diagramMap = new Map<string, Diagram>();
  for (const d of diagrams) {
    diagramMap.set(d.id, d);
  }

  const elementsByDiagram = new Map<string, MavisElement[]>();
  for (const el of elements) {
    if (el.isDeleted) continue;
    const list = elementsByDiagram.get(el.diagramId) ?? [];
    list.push(el);
    elementsByDiagram.set(el.diagramId, list);
  }

  const elementMap = new Map<string, MavisElement>();
  for (const el of elements) {
    if (!el.isDeleted) elementMap.set(el.id, el);
  }

  const lines: string[] = [];

  const rootDiagram = diagramMap.get(rootDiagramId);
  const title = projectName ?? rootDiagram?.title ?? 'Untitled';
  lines.push(`# Architecture: ${title}`);
  lines.push('');

  // Render diagrams recursively starting from root
  serializeDiagram(rootDiagramId, diagramMap, elementsByDiagram, elementMap, lines, 0);

  return lines.join('\n');
}

// ── Internals ───────────────────────────────────────────────

function serializeDiagram(
  diagramId: string,
  diagramMap: Map<string, Diagram>,
  elementsByDiagram: Map<string, MavisElement[]>,
  elementMap: Map<string, MavisElement>,
  lines: string[],
  depth: number,
): void {
  const diagram = diagramMap.get(diagramId);
  if (!diagram) return;

  const diagramElements = elementsByDiagram.get(diagramId) ?? [];
  const headingPrefix = '#'.repeat(Math.min(depth + 2, 6));

  if (depth > 0) {
    lines.push(`${headingPrefix} ${diagram.title}`);
    lines.push('');
  }

  // Separate element types
  const shapes: MavisElement[] = [];
  const connections: LinearElement[] = [];
  const portals: PortalElement[] = [];

  for (const el of diagramElements) {
    if (el.type === 'arrow' || el.type === 'line') {
      connections.push(el as LinearElement);
    } else if (el.type === 'portal') {
      portals.push(el as PortalElement);
    } else if (el.type !== 'freedraw') {
      shapes.push(el);
    }
  }

  // Elements section
  if (shapes.length > 0 || portals.length > 0) {
    lines.push(`${headingPrefix}# Elements`);
    lines.push('');

    for (const el of shapes) {
      const label = getElementLabel(el, elementMap);
      const connectedTo = getConnections(el.id, connections, elementMap);
      let line = `- [${el.type}] "${label}"`;
      if (connectedTo.length > 0) {
        line += ` → connected to ${connectedTo.map((c) => `"${c}"`).join(', ')}`;
      }
      lines.push(line);

      // GitHub link for shapes (future: when shapes can have links)
    }

    for (const portal of portals) {
      const targetDiagram = diagramMap.get(portal.targetDiagramId);
      let line = `- [portal] "${portal.label}"`;
      if (targetDiagram) {
        line += ` → drills into "${targetDiagram.title}"`;
      }
      lines.push(line);

      if (portal.githubLink) {
        lines.push(`  - github: ${formatGitHubLink(portal.githubLink)}`);
      }
    }

    lines.push('');
  }

  // Connections section
  if (connections.length > 0) {
    const namedConnections = connections.filter((c) => c.startBinding && c.endBinding);
    if (namedConnections.length > 0) {
      lines.push(`${headingPrefix}# Connections`);
      lines.push('');

      for (const conn of namedConnections) {
        const fromEl = conn.startBinding ? elementMap.get(conn.startBinding.elementId) : null;
        const toEl = conn.endBinding ? elementMap.get(conn.endBinding.elementId) : null;
        if (!fromEl || !toEl) continue;

        const fromLabel = getElementLabel(fromEl, elementMap);
        const toLabel = getElementLabel(toEl, elementMap);

        // Check for bound text label on the arrow
        const arrowLabel = getBoundText(conn, elementMap);
        const arrowType = conn.type === 'arrow' ? '-->' : '---';

        if (arrowLabel) {
          lines.push(`- "${fromLabel}" ${arrowType}[${arrowLabel}] "${toLabel}"`);
        } else {
          lines.push(`- "${fromLabel}" ${arrowType} "${toLabel}"`);
        }
      }

      lines.push('');
    }
  }

  // Render nested diagrams
  for (const portal of portals) {
    if (portal.targetDiagramId && diagramMap.has(portal.targetDiagramId)) {
      serializeDiagram(
        portal.targetDiagramId,
        diagramMap,
        elementsByDiagram,
        elementMap,
        lines,
        depth + 1,
      );
    }
  }
}

function getElementLabel(el: MavisElement, elementMap: Map<string, MavisElement>): string {
  // If this is a text element, use its text
  if (el.type === 'text') {
    return (el as TextElement).text.trim() || 'Unnamed';
  }

  // If this is a portal, use its label
  if (el.type === 'portal') {
    return (el as PortalElement).label || 'Unnamed Portal';
  }

  // Check for bound text (text inside a shape)
  const boundText = getBoundText(el, elementMap);
  if (boundText) return boundText;

  // Fallback to type + truncated id
  return `${el.type}_${el.id.slice(0, 6)}`;
}

function getBoundText(
  el: MavisElement,
  elementMap: Map<string, MavisElement>,
): string | null {
  for (const bound of el.boundElements) {
    if (bound.type === 'text') {
      const textEl = elementMap.get(bound.id) as TextElement | undefined;
      if (textEl?.text) return textEl.text.trim();
    }
  }
  return null;
}

function getConnections(
  elementId: string,
  connections: LinearElement[],
  elementMap: Map<string, MavisElement>,
): string[] {
  const targets: string[] = [];
  for (const conn of connections) {
    if (conn.startBinding?.elementId === elementId && conn.endBinding) {
      const target = elementMap.get(conn.endBinding.elementId);
      if (target) targets.push(getElementLabel(target, elementMap));
    }
  }
  return targets;
}

function formatGitHubLink(link: GitHubLink): string {
  let result = `${link.owner}/${link.repo}`;
  if (link.path) {
    result += ` @ ${link.path}`;
  }
  if (link.ref && link.ref !== 'main' && link.ref !== 'HEAD') {
    result += ` (${link.ref})`;
  }
  return result;
}
