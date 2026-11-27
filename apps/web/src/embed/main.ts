import '@fontsource/architects-daughter/latin-400.css';
import type { MavisElement } from '@mavisdraw/types';
import { renderSvgMarkup, safeColor } from '@mavisdraw/export/svg-markup';
import { API_BASE } from '../services/apiBase';
import { ancestry, fitView, parseEmbedUrl, zoomAt, type EmbedDiagram, type View } from './model';

/**
 * The public, read-only map viewer that runs inside iframes (docs, wikis,
 * Notion…): no editor, no sign-in. Click a nested system to look inside,
 * drag to pan, Ctrl/⌘ + scroll (or the buttons) to zoom. Plain scrolling is
 * left to the page around the iframe.
 */

interface EmbedProject {
  project: { id: string; name: string };
  rootDiagramId: string;
  diagrams: EmbedDiagram[];
}

interface DiagramData {
  id: string;
  title: string;
  renderMode: string;
  viewBackgroundColor: string;
  elements: MavisElement[];
}

const REFRESH_MS = 60_000;

const root = document.getElementById('embed')!;
const options = parseEmbedUrl(window.location.search);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function showMessage(message: string, retry?: () => void) {
  root.replaceChildren();
  const box = el('div', { class: 'message', role: 'status' });
  box.append(el('p', {}, message));
  if (retry) {
    const button = el('button', { type: 'button' }, 'Try again');
    button.addEventListener('click', retry);
    box.append(button);
  }
  root.append(box);
}

function applyTheme(theme: 'light' | 'dark' | 'auto'): 'light' | 'dark' {
  const resolved =
    theme === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

class NotAvailable extends Error {}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (res.status === 404) throw new NotAvailable();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function start() {
  if (!options) {
    showMessage('This embed link is incomplete.');
    return;
  }
  const theme = applyTheme(options.theme);
  const { token } = options;

  let project: EmbedProject;
  try {
    project = await getJson<EmbedProject>(`/api/embed/${token}`);
  } catch (err) {
    if (err instanceof NotAvailable) showMessage('This embed is no longer available.');
    else showMessage("Couldn't load this map.", () => void start());
    return;
  }
  document.title = `${project.project.name} · MavisDraw`;
  const rootId = project.rootDiagramId;
  const titles = new Map(project.diagrams.map((d) => [d.id, d.title]));
  let path = ancestry(project.diagrams, options.diagramId ?? rootId, rootId);
  const cache = new Map<string, DiagramData>();

  // ── Layout ───────────────────────────────────────────────
  root.replaceChildren();
  const bar = el('header', { class: 'bar' });
  const crumbs = el('nav', { class: 'crumbs', 'aria-label': 'Where you are in the map' });
  const actions = el('div', { class: 'actions' });
  const zoomOut = el(
    'button',
    { type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out' },
    '−',
  );
  const fit = el('button', { type: 'button', 'aria-label': 'Fit to view', title: 'Fit' }, '⤢');
  const zoomIn = el('button', { type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in' }, '+');
  const open = el(
    'a',
    { class: 'open', target: '_blank', rel: 'noopener', title: 'Open in MavisDraw' },
    'Open in MavisDraw ↗',
  );
  actions.append(zoomOut, fit, zoomIn, open);
  bar.append(crumbs, actions);
  const canvas = el('div', { class: 'canvas', tabindex: '0', 'aria-label': 'Diagram' });
  const stage = el('div', { class: 'stage' });
  canvas.append(stage);
  root.append(bar, canvas);

  // ── Pan & zoom ───────────────────────────────────────────
  let view: View = { x: 0, y: 0, scale: 1 };
  let content = { w: 0, h: 0 };
  const applyView = () => {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  };
  const fitToView = () => {
    view = fitView(content.w, content.h, canvas.clientWidth, canvas.clientHeight);
    applyView();
  };
  const zoomBy = (factor: number) => {
    view = zoomAt(view, factor, canvas.clientWidth / 2, canvas.clientHeight / 2);
    applyView();
  };
  zoomIn.addEventListener('click', () => zoomBy(1.25));
  zoomOut.addEventListener('click', () => zoomBy(0.8));
  fit.addEventListener('click', fitToView);
  window.addEventListener('resize', fitToView);

  canvas.addEventListener(
    'wheel',
    (e) => {
      // Plain scrolling belongs to the page around the iframe
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      view = zoomAt(view, Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      applyView();
    },
    { passive: false },
  );

  // Pointer capture retargets later events to the canvas: remember what was pressed
  let drag: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
    target: EventTarget | null;
  } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    canvas.classList.add('panning');
    view = { ...view, x: drag.vx + dx, y: drag.vy + dy };
    applyView();
  });
  canvas.addEventListener('pointerup', () => {
    const pressed = drag;
    drag = null;
    canvas.classList.remove('panning');
    if (!pressed || pressed.moved) return;
    // A click: on a nested system, look inside
    const target = (pressed.target as Element | null)?.closest?.('g.portal');
    const id = target?.getAttribute('data-portal');
    if (id && titles.has(id)) void go([...path, id]);
  });

  // ── Showing a diagram ────────────────────────────────────
  const currentId = () => path[path.length - 1];

  const renderCrumbs = () => {
    crumbs.replaceChildren();
    path.forEach((id, i) => {
      if (i > 0) crumbs.append(el('span', { class: 'sep', 'aria-hidden': 'true' }, '›'));
      const label = i === 0 ? project.project.name : (titles.get(id) ?? 'Diagram');
      if (i === path.length - 1) {
        crumbs.append(el('span', { class: 'current', 'aria-current': 'page' }, label));
      } else {
        const b = el('button', { type: 'button' }, label);
        b.addEventListener('click', () => void go(path.slice(0, i + 1)));
        crumbs.append(b);
      }
    });
    const diagramPart = currentId() === rootId ? '' : `/d/${currentId()}`;
    open.setAttribute('href', `${window.location.origin}/p/${project.project.id}${diagramPart}`);
  };

  const draw = (data: DiagramData, refit: boolean) => {
    const markup = renderSvgMarkup(data.elements, {
      renderMode: data.renderMode === 'sketchy' ? 'sketchy' : 'clean',
      theme,
      background: false,
      portalHooks: true,
    });
    const svg = document.importNode(
      new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement,
      true,
    ) as unknown as SVGSVGElement;
    const [, , w, h] = (svg.getAttribute('viewBox') ?? '0 0 0 0').split(' ').map(Number);
    content = { w, h };
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    // Nested systems: reachable by keyboard and screen readers too
    for (const portal of Array.from(svg.querySelectorAll('g.portal'))) {
      const id = portal.getAttribute('data-portal') ?? '';
      if (!titles.has(id)) continue;
      portal.setAttribute('tabindex', '0');
      portal.setAttribute('role', 'button');
      portal.setAttribute('aria-label', `Look inside ${portal.getAttribute('data-label') ?? ''}`);
      portal.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
          e.preventDefault();
          void go([...path, id]);
        }
      });
    }
    canvas.style.background =
      theme === 'dark' ? '#0d1117' : safeColor(data.viewBackgroundColor, '#ffffff');
    stage.replaceChildren(svg);
    if (refit) fitToView();
  };

  const load = async (id: string, fresh = false): Promise<DiagramData> => {
    const cached = cache.get(id);
    if (cached && !fresh) return cached;
    const { diagram } = await getJson<{ diagram: DiagramData }>(
      `/api/embed/${token}/diagrams/${encodeURIComponent(id)}`,
    );
    cache.set(id, diagram);
    return diagram;
  };

  const go = async (next: string[]) => {
    path = next;
    renderCrumbs();
    stage.classList.add('loading');
    try {
      draw(await load(currentId()), true);
    } catch (err) {
      if (err instanceof NotAvailable) showMessage('This embed is no longer available.');
      else showMessage("Couldn't load this diagram.", () => void start());
      return;
    } finally {
      stage.classList.remove('loading');
    }
    canvas.focus({ preventScroll: true });
  };

  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Escape' || e.key === 'Backspace') && path.length > 1) {
      e.preventDefault();
      void go(path.slice(0, -1));
    }
  });

  // The map changes as the team works: stay current without reloading
  const refresh = async () => {
    try {
      const id = currentId();
      const before = cache.get(id);
      const data = await load(id, true);
      if (currentId() === id && JSON.stringify(data) !== JSON.stringify(before)) draw(data, false);
    } catch {
      // Keep showing what we have
    }
  };
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void refresh();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });

  await go(path);
}

void start();
