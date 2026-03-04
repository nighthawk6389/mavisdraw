import type {
  MavisElement,
  Diagram,
  RectangleElement,
  LinearElement,
  TextElement,
} from '@mavisdraw/types';
import { buildDrawioStyle, mapArrowheadToDrawio } from './mapping';

/**
 * Convert MavisDraw elements to draw.io XML format.
 * Produces a valid .drawio XML file.
 */
export function exportToDrawio(
  diagrams: Diagram[],
  elementsByDiagram: Map<string, MavisElement[]>,
): string {
  const diagramXmls: string[] = [];

  for (const diagram of diagrams) {
    const elements = (elementsByDiagram.get(diagram.id) ?? []).filter((el) => !el.isDeleted);
    const xml = buildDiagramXml(diagram, elements);
    diagramXmls.push(xml);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="mavisdraw" modified="' + new Date().toISOString() + '" agent="MavisDraw" type="device">',
    ...diagramXmls,
    '</mxfile>',
  ].join('\n');
}

function buildDiagramXml(diagram: Diagram, elements: MavisElement[]): string {
  const lines: string[] = [];

  lines.push(
    `  <diagram name="${escapeXml(diagram.title)}" id="${diagram.id}">`,
  );
  lines.push(
    `    <mxGraphModel dx="0" dy="0" grid="1" gridSize="${diagram.gridSize}" ` +
      `guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" ` +
      `pageScale="1" pageWidth="1100" pageHeight="850" ` +
      `background="${diagram.viewBackgroundColor}">`,
  );
  lines.push('      <root>');
  lines.push('        <mxCell id="0" />');
  lines.push('        <mxCell id="1" parent="0" />');

  // Build a map of text elements bound to containers
  const boundTextMap = new Map<string, TextElement>();
  for (const el of elements) {
    if (el.type === 'text') {
      const textEl = el as TextElement;
      if (textEl.containerId) {
        boundTextMap.set(textEl.containerId, textEl);
      }
    }
  }

  for (const el of elements) {
    // Skip bound text elements — they're merged into parent's value
    if (el.type === 'text' && (el as TextElement).containerId) continue;
    // Skip portals — no draw.io equivalent
    if (el.type === 'portal') continue;
    // Skip images — draw.io handles them differently
    if (el.type === 'image') continue;

    const cellXml = elementToMxCell(el, boundTextMap);
    if (cellXml) lines.push(cellXml);
  }

  lines.push('      </root>');
  lines.push('    </mxGraphModel>');
  lines.push('  </diagram>');

  return lines.join('\n');
}

function elementToMxCell(
  el: MavisElement,
  boundTextMap: Map<string, TextElement>,
): string | null {
  switch (el.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
    case 'triangle':
      return shapeToMxCell(el, boundTextMap);
    case 'text':
      return textToMxCell(el as TextElement);
    case 'line':
    case 'arrow':
      return linearToMxCell(el as LinearElement, boundTextMap);
    case 'freedraw':
      return null; // draw.io doesn't support freedraw
    default:
      return null;
  }
}

function shapeToMxCell(
  el: MavisElement,
  boundTextMap: Map<string, TextElement>,
): string {
  const styles = new Map<string, string>();

  // Shape type
  switch (el.type) {
    case 'ellipse':
      styles.set('_shape', 'ellipse');
      break;
    case 'diamond':
      styles.set('_shape', 'rhombus');
      break;
    case 'triangle':
      styles.set('_shape', 'triangle');
      break;
    case 'rectangle': {
      const rect = el as RectangleElement;
      if (rect.roundness > 0) styles.set('rounded', '1');
      else styles.set('rounded', '0');
      break;
    }
  }

  styles.set('whiteSpace', 'wrap');
  styles.set('html', '1');

  if (el.backgroundColor !== 'transparent') {
    styles.set('fillColor', el.backgroundColor);
  }
  styles.set('strokeColor', el.strokeColor);
  styles.set('strokeWidth', String(el.strokeWidth));
  if (el.strokeStyle === 'dashed') styles.set('dashed', '1');
  if (el.opacity < 100) styles.set('opacity', String(el.opacity));

  // Merge bound text into value
  const boundText = boundTextMap.get(el.id);
  const value = boundText ? escapeXml(boundText.text) : '';

  return (
    `        <mxCell id="${el.id}" value="${value}" ` +
    `style="${buildDrawioStyle(styles)}" vertex="1" parent="1">\n` +
    `          <mxGeometry x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" as="geometry" />\n` +
    `        </mxCell>`
  );
}

function textToMxCell(el: TextElement): string {
  const styles = new Map<string, string>();
  styles.set('_shape', 'text');
  styles.set('html', '1');
  styles.set('fontSize', String(el.fontSize));
  styles.set('align', el.textAlign);
  styles.set('verticalAlign', el.verticalAlign);
  styles.set('strokeColor', el.strokeColor);

  return (
    `        <mxCell id="${el.id}" value="${escapeXml(el.text)}" ` +
    `style="${buildDrawioStyle(styles)}" vertex="1" parent="1">\n` +
    `          <mxGeometry x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" as="geometry" />\n` +
    `        </mxCell>`
  );
}

function linearToMxCell(
  el: LinearElement,
  boundTextMap: Map<string, TextElement>,
): string {
  const styles = new Map<string, string>();

  // Routing
  if (el.routingMode === 'elbow') {
    styles.set('edgeStyle', 'orthogonalEdgeStyle');
  } else if (el.routingMode === 'curved') {
    styles.set('curved', '1');
  }

  styles.set('rounded', '0');
  styles.set('html', '1');
  styles.set('strokeColor', el.strokeColor);
  styles.set('strokeWidth', String(el.strokeWidth));
  if (el.strokeStyle === 'dashed') styles.set('dashed', '1');

  // Arrowheads
  if (el.type === 'arrow') {
    styles.set('endArrow', mapArrowheadToDrawio(el.endArrowhead));
    styles.set('startArrow', mapArrowheadToDrawio(el.startArrowhead));
  } else {
    styles.set('endArrow', 'none');
    styles.set('startArrow', 'none');
  }

  const sourceId = el.startBinding?.elementId || '';
  const targetId = el.endBinding?.elementId || '';
  const sourceAttr = sourceId ? ` source="${sourceId}"` : '';
  const targetAttr = targetId ? ` target="${targetId}"` : '';

  // Merge bound text
  const boundText = boundTextMap.get(el.id);
  const value = boundText ? escapeXml(boundText.text) : '';

  let waypoints = '';
  if (el.points.length > 2) {
    const midPoints = el.points.slice(1, -1);
    if (midPoints.length > 0) {
      const pointsXml = midPoints
        .map(([x, y]) => `              <mxPoint x="${el.x + x}" y="${el.y + y}" />`)
        .join('\n');
      waypoints = `\n            <Array as="points">\n${pointsXml}\n            </Array>\n          `;
    }
  }

  return (
    `        <mxCell id="${el.id}" value="${value}" ` +
    `style="${buildDrawioStyle(styles)}" edge="1" parent="1"${sourceAttr}${targetAttr}>\n` +
    `          <mxGeometry relative="1" as="geometry">${waypoints}</mxGeometry>\n` +
    `        </mxCell>`
  );
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
