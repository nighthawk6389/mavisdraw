import type { Point } from '@mavisdraw/types';
import { useDiagramStore } from '../stores/diagramStore';
import { useElementsStore } from '../stores/elementsStore';
import { useRepoStore } from '../repo/repoStore';
import { useSelectionStore } from '../stores/selectionStore';
import { getCanvasController } from '../components/canvas/canvasController';
import { toast } from '../stores/toastStore';
import { findTemplate, type Template } from './templates';

/**
 * What to do once a just-created project opens: start it from a template
 * (`?template=<id>`) or open "Map a repository" (`?start=repo`). Read while
 * the project loads, run once the editor is on screen, then dropped from
 * the address bar so a reload doesn't repeat it.
 */
export type StartupAction = { kind: 'template'; template: Template } | { kind: 'map-repo' };

const PARAMS = ['template', 'start'];
let pending: { projectId: string; action: StartupAction } | null = null;

/** Parse the startup parameters of a project URL. */
export function parseStartupAction(search: string): StartupAction | null {
  const params = new URLSearchParams(search);
  const template = findTemplate(params.get('template'));
  if (template) return { kind: 'template', template };
  if (params.get('start') === 'repo') return { kind: 'map-repo' };
  return null;
}

/** Remove the startup parameters, keeping any others (?thread=, ?proposals=). */
export function withoutStartupParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const p of PARAMS) params.delete(p);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/** While the project loads: remember what to do, and clean the address bar. */
export function captureStartupAction(projectId: string): void {
  const action = parseStartupAction(window.location.search);
  pending = action ? { projectId, action } : null;
  if (PARAMS.some((p) => new URLSearchParams(window.location.search).has(p))) {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${withoutStartupParams(window.location.search)}`,
    );
  }
}

/** The action for this project, once. */
export function takeStartupAction(projectId: string): StartupAction | null {
  if (!pending || pending.projectId !== projectId) return null;
  const { action } = pending;
  pending = null;
  return action;
}

/** Is the diagram on screen empty (nothing to overwrite or mix with)? */
export function activeDiagramIsEmpty(): boolean {
  const diagramId = useDiagramStore.getState().activeDiagramId;
  for (const el of useElementsStore.getState().elements.values()) {
    if (el.diagramId === diagramId && !el.isDeleted) return false;
  }
  return true;
}

/**
 * Lay a template out on the diagram on screen (its subgraphs become nested
 * diagrams), then frame it.
 */
export async function insertTemplate(
  template: Template,
  at: Point = { x: 0, y: 0 },
  options: { select?: boolean } = {},
) {
  const [{ parseMermaidFlowchart }, { importMermaidGraph }] = await Promise.all([
    import('@mavisdraw/compat'),
    import('../import/mermaidImport'),
  ]);
  const result = await importMermaidGraph(parseMermaidFlowchart(template.mermaid), at);
  // A fresh map is for looking at: nothing selected (and no style panel
  // squeezing the canvas after it's been framed)
  if (options.select === false) useSelectionStore.getState().clearSelection();
  getCanvasController()?.invalidate();
  // Let the canvas and the panels settle before framing the map
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  getCanvasController()?.zoomToFit();
  return result;
}

export async function runStartupAction(action: StartupAction): Promise<void> {
  if (action.kind === 'map-repo') {
    useRepoStore.getState().setDialogOpen(true);
    return;
  }
  // Never mix a template into a map that already has something on it
  if (!activeDiagramIsEmpty()) return;
  try {
    const result = await insertTemplate(action.template, { x: 0, y: 0 }, { select: false });
    const levels = result.diagrams;
    toast(
      `Started from “${action.template.name}”${levels > 0 ? ` — double-click a box marked ↗ to look inside (${levels} nested ${levels === 1 ? 'diagram' : 'diagrams'})` : ''}`,
      'success',
      undefined,
      10_000,
    );
  } catch (err) {
    toast(`Couldn't start from the template: ${err instanceof Error ? err.message : err}`, 'error');
  }
}
