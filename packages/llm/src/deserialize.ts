import type { Diagram } from '@mavisdraw/types';
import type {
  MavisElement,
  RectangleElement,
  PortalElement,
  LinearElement,
  TextElement,
  GitHubLink,
} from '@mavisdraw/types';
import type { MavisDrawScene } from '@mavisdraw/types';

// ── Public API ──────────────────────────────────────────────

/**
 * Parse LLM-readable structured Markdown back into a MavisDraw scene.
 *
 * This is a best-effort parser. LLM-generated text may not match exactly,
 * so we're lenient with formatting while preserving topology.
 */
export function deserializeScene(markdown: string): MavisDrawScene {
  const lines = markdown.split('\n');
  const ctx = new ParseContext();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Heading — new diagram section
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];

      // Skip "Elements" and "Connections" sub-headings
      if (title === 'Elements' || title === 'Connections') continue;

      // "Architecture: ..." is the root
      if (title.startsWith('Architecture:')) {
        ctx.rootTitle = title.replace('Architecture:', '').trim();
        continue;
      }

      // Nested diagram
      ctx.pushDiagram(title, level);
      continue;
    }

    // Element line: - [type] "label" ...
    const elementMatch = trimmed.match(
      /^-\s+\[(\w+)\]\s+"([^"]+)"(?:\s+→\s+(.+))?$/,
    );
    if (elementMatch) {
      const type = elementMatch[1];
      const label = elementMatch[2];
      const rest = elementMatch[3] ?? '';

      if (type === 'portal') {
        const drillMatch = rest.match(/drills into "([^"]+)"/);
        ctx.addPortal(label, drillMatch?.[1] ?? null);
      } else {
        const connectedTo = parseConnectedTo(rest);
        ctx.addShape(type, label, connectedTo);
      }
      continue;
    }

    // GitHub link: - github: owner/repo @ path
    const githubMatch = trimmed.match(
      /^-\s+github:\s+([^/\s]+)\/([^\s@]+)(?:\s+@\s+([^\s(]+))?(?:\s+\(([^)]+)\))?$/,
    );
    if (githubMatch) {
      ctx.setLastPortalGitHub({
        owner: githubMatch[1],
        repo: githubMatch[2],
        path: githubMatch[3] ?? '',
        ref: githubMatch[4] ?? 'main',
      });
      continue;
    }

    // Connection line: - "from" --> "to" or - "from" -->[label] "to"
    const connMatch = trimmed.match(
      /^-\s+"([^"]+)"\s+--[->]+(?:\[([^\]]*)\])?\s+"([^"]+)"$/,
    );
    if (connMatch) {
      ctx.addConnection(connMatch[1], connMatch[3], connMatch[2] ?? null);
      continue;
    }
  }

  return ctx.toScene();
}

// ── Parse Helpers ───────────────────────────────────────────

function parseConnectedTo(rest: string): string[] {
  const match = rest.match(/connected to\s+(.+)/);
  if (!match) return [];
  // Split by comma, strip quotes
  return match[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
}

// ── Parse Context ───────────────────────────────────────────

let nextId = 1;
function genId(): string {
  return `parsed_${nextId++}`;
}

interface ParsedShape {
  id: string;
  type: string;
  label: string;
  connectedTo: string[];
  diagramId: string;
}

interface ParsedPortal {
  id: string;
  label: string;
  targetDiagramTitle: string | null;
  githubLink: GitHubLink | null;
  diagramId: string;
}

interface ParsedConnection {
  fromLabel: string;
  toLabel: string;
  label: string | null;
  diagramId: string;
}

class ParseContext {
  rootTitle = 'Untitled';
  diagrams: Map<string, { id: string; title: string; parentId: string | null; level: number }> =
    new Map();
  shapes: ParsedShape[] = [];
  portals: ParsedPortal[] = [];
  connections: ParsedConnection[] = [];

  private currentDiagramId: string;
  private rootDiagramId: string;
  private lastPortalId: string | null = null;
  private diagramStack: Array<{ id: string; level: number }> = [];

  constructor() {
    this.rootDiagramId = genId();
    this.currentDiagramId = this.rootDiagramId;
  }

  pushDiagram(title: string, level: number): void {
    // Pop stack back to parent level
    while (this.diagramStack.length > 0) {
      const top = this.diagramStack[this.diagramStack.length - 1];
      if (top.level >= level) {
        this.diagramStack.pop();
      } else {
        break;
      }
    }

    const parentId =
      this.diagramStack.length > 0
        ? this.diagramStack[this.diagramStack.length - 1].id
        : this.rootDiagramId;

    const id = genId();
    this.diagrams.set(title, { id, title, parentId, level });
    this.diagramStack.push({ id, level });
    this.currentDiagramId = id;
  }

  addShape(type: string, label: string, connectedTo: string[]): void {
    this.shapes.push({
      id: genId(),
      type,
      label,
      connectedTo,
      diagramId: this.currentDiagramId,
    });
    this.lastPortalId = null;
  }

  addPortal(label: string, targetTitle: string | null): void {
    const id = genId();
    this.portals.push({
      id,
      label,
      targetDiagramTitle: targetTitle,
      githubLink: null,
      diagramId: this.currentDiagramId,
    });
    this.lastPortalId = id;
  }

  setLastPortalGitHub(link: GitHubLink): void {
    if (!this.lastPortalId) return;
    const portal = this.portals.find((p) => p.id === this.lastPortalId);
    if (portal) portal.githubLink = link;
  }

  addConnection(fromLabel: string, toLabel: string, label: string | null): void {
    this.connections.push({
      fromLabel,
      toLabel,
      label,
      diagramId: this.currentDiagramId,
    });
  }

  toScene(): MavisDrawScene {
    const now = Date.now();
    const baseProps = {
      angle: 0,
      opacity: 100,
      strokeColor: '#1e1e1e',
      backgroundColor: 'transparent',
      fillStyle: 'none' as const,
      strokeWidth: 2,
      strokeStyle: 'solid' as const,
      roughness: 1,
      seed: Math.floor(Math.random() * 100000),
      renderMode: 'sketchy' as const,
      layerId: 'default',
      groupIds: [] as string[],
      isLocked: false,
      isDeleted: false,
      boundElements: [] as { id: string; type: string }[],
      version: 1,
      updatedAt: now,
    };

    // Build label -> element id map for resolving connections
    const labelToId = new Map<string, string>();

    const elements: MavisElement[] = [];
    const allDiagrams: Diagram[] = [];

    // Root diagram
    allDiagrams.push({
      id: this.rootDiagramId,
      projectId: 'project_1',
      parentDiagramId: null,
      parentPortalId: null,
      title: this.rootTitle,
      viewBackgroundColor: '#ffffff',
      gridEnabled: true,
      gridSize: 20,
      renderMode: 'sketchy',
      layers: [{ id: 'default', name: 'Default', isVisible: true, isLocked: false, opacity: 100, order: 0 }],
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    });

    // Nested diagrams
    for (const [, d] of this.diagrams) {
      allDiagrams.push({
        id: d.id,
        projectId: 'project_1',
        parentDiagramId: d.parentId,
        parentPortalId: null,
        title: d.title,
        viewBackgroundColor: '#ffffff',
        gridEnabled: true,
        gridSize: 20,
        renderMode: 'sketchy',
        layers: [{ id: 'default', name: 'Default', isVisible: true, isLocked: false, opacity: 100, order: 0 }],
        createdBy: 'system',
        createdAt: now,
        updatedAt: now,
      });
    }

    // Layout shapes in a grid
    let col = 0;
    let row = 0;
    const GRID_X = 250;
    const GRID_Y = 150;

    // Create shape elements
    for (const s of this.shapes) {
      const x = 100 + col * GRID_X;
      const y = 100 + row * GRID_Y;
      col++;
      if (col >= 4) {
        col = 0;
        row++;
      }

      labelToId.set(s.label, s.id);

      const el: RectangleElement = {
        ...baseProps,
        id: s.id,
        type: 'rectangle',
        diagramId: s.diagramId,
        x,
        y,
        width: 180,
        height: 80,
        roundness: 8,
      };
      elements.push(el);

      // Create bound text
      const textId = genId();
      const text: TextElement = {
        ...baseProps,
        id: textId,
        type: 'text',
        diagramId: s.diagramId,
        x: x + 10,
        y: y + 20,
        width: 160,
        height: 40,
        text: s.label,
        fontSize: 16,
        fontFamily: 'sans-serif',
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: s.id,
        lineHeight: 1.25,
      };
      elements.push(text);

      // Update shape's boundElements
      el.boundElements = [{ id: textId, type: 'text' }];
    }

    // Create portals
    for (const p of this.portals) {
      const x = 100 + col * GRID_X;
      const y = 100 + row * GRID_Y;
      col++;
      if (col >= 4) {
        col = 0;
        row++;
      }

      labelToId.set(p.label, p.id);

      const targetDiagram = p.targetDiagramTitle
        ? this.diagrams.get(p.targetDiagramTitle)
        : null;

      const portal: PortalElement = {
        ...baseProps,
        id: p.id,
        type: 'portal',
        diagramId: p.diagramId,
        x,
        y,
        width: 180,
        height: 80,
        targetDiagramId: targetDiagram?.id ?? '',
        label: p.label,
        thumbnailDataUrl: null,
        portalStyle: 'card',
        githubLink: p.githubLink,
      };
      elements.push(portal);
    }

    // Create connections (arrows)
    for (const c of this.connections) {
      const fromId = labelToId.get(c.fromLabel);
      const toId = labelToId.get(c.toLabel);
      if (!fromId || !toId) continue;

      const arrowId = genId();
      const arrow: LinearElement = {
        ...baseProps,
        id: arrowId,
        type: 'arrow',
        diagramId: c.diagramId,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
        startBinding: { elementId: fromId, gap: 5 },
        endBinding: { elementId: toId, gap: 5 },
        routingMode: 'straight',
        startArrowhead: 'none',
        endArrowhead: 'arrow',
      };
      elements.push(arrow);

      // Add arrow label if present
      if (c.label) {
        const textId = genId();
        const text: TextElement = {
          ...baseProps,
          id: textId,
          type: 'text',
          diagramId: c.diagramId,
          x: 0,
          y: 0,
          width: 100,
          height: 20,
          text: c.label,
          fontSize: 14,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: arrowId,
          lineHeight: 1.25,
        };
        elements.push(text);
        arrow.boundElements = [{ id: textId, type: 'text' }];
      }

      // Update bound elements on source and target
      const fromEl = elements.find((e) => e.id === fromId);
      const toEl = elements.find((e) => e.id === toId);
      if (fromEl) fromEl.boundElements.push({ id: arrowId, type: 'arrow' });
      if (toEl) toEl.boundElements.push({ id: arrowId, type: 'arrow' });
    }

    return {
      diagrams: allDiagrams,
      elements,
      rootDiagramId: this.rootDiagramId,
    };
  }
}
