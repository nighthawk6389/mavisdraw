import { useEffect, useRef } from 'react';
import type { LinearElement, MavisElement } from '@mavisdraw/types';
import { useElementsStore } from '../../stores/elementsStore';
import { useDiagramStore } from '../../stores/diagramStore';
import { useViewportStore } from '../../stores/viewportStore';
import { useThemeStore } from '../../stores/themeStore';
import { useUIStore } from '../../stores/uiStore';
import { getCanvasController } from './canvasController';
import { getVisualBounds } from './HitTesting';
import { minimapLayout, minimapToCanvas, visibleBounds, type MinimapLayout } from './minimapLayout';

const WIDTH = 200;
const HEIGHT = 136;
/** While shapes move, the overview needn't follow every frame. */
const ELEMENT_REDRAW_MS = 100;

const COLORS = {
  light: { shape: 'rgba(55, 65, 81, 0.35)', line: 'rgba(55, 65, 81, 0.6)', view: '#2563eb' },
  dark: { shape: 'rgba(228, 228, 231, 0.35)', line: 'rgba(228, 228, 231, 0.6)', view: '#60a5fa' },
};

/**
 * An overview of the diagram on screen (M to show or hide): its shapes, and
 * where the view is. Click or drag in it to move the view there.
 */
export default function Minimap() {
  const show = useUIStore((s) => s.showMinimap);
  if (!show) return null;
  return <MinimapCanvas />;
}

function MinimapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<MinimapLayout | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let lastElementDraw = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const draw = () => {
      frame = 0;
      const container = canvas.closest('[data-canvas-container]') as HTMLElement | null;
      const screen = container?.getBoundingClientRect() ?? { width: 800, height: 600 };
      const vp = useViewportStore.getState();
      const view = visibleBounds(vp, screen);
      const diagramId = useDiagramStore.getState().activeDiagramId;
      const shapes: MavisElement[] = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const el of useElementsStore.getState().elements.values()) {
        if (el.isDeleted || el.diagramId !== diagramId) continue;
        if (el.type === 'text' && el.containerId) continue;
        shapes.push(el);
        const b = getVisualBounds(el);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
      const content =
        shapes.length > 0 ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
      const layout = minimapLayout(content, view, { width: WIDTH, height: HEIGHT });
      layoutRef.current = layout;
      const colors = COLORS[useThemeStore.getState().theme];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.save();
      ctx.translate(layout.offsetX, layout.offsetY);
      ctx.scale(layout.scale, layout.scale);
      const px = 1 / layout.scale;
      for (const el of shapes) {
        if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
          const points = (el as LinearElement).points ?? [];
          if (points.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(el.x + points[0][0], el.y + points[0][1]);
          for (const [x, y] of points.slice(1)) ctx.lineTo(el.x + x, el.y + y);
          ctx.strokeStyle = colors.line;
          ctx.lineWidth = px;
          ctx.stroke();
          continue;
        }
        const b = getVisualBounds(el);
        ctx.fillStyle = colors.shape;
        if (el.type === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(
            b.x + b.width / 2,
            b.y + b.height / 2,
            b.width / 2,
            b.height / 2,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else {
          ctx.fillRect(b.x, b.y, Math.max(b.width, px), Math.max(b.height, px));
        }
      }
      // Where the view is
      ctx.strokeStyle = colors.view;
      ctx.lineWidth = 1.5 * px;
      ctx.fillStyle = `${colors.view}14`;
      ctx.fillRect(view.x, view.y, view.width, view.height);
      ctx.strokeRect(view.x, view.y, view.width, view.height);
      ctx.restore();
    };

    const soon = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const elementsChanged = () => {
      const wait = ELEMENT_REDRAW_MS - (performance.now() - lastElementDraw);
      if (wait <= 0) {
        lastElementDraw = performance.now();
        soon();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          lastElementDraw = performance.now();
          soon();
        }, wait);
      }
    };

    draw();
    const unsubscribe = [
      useElementsStore.subscribe((s, prev) => {
        if (s.elements !== prev.elements) elementsChanged();
      }),
      useViewportStore.subscribe(soon),
      useDiagramStore.subscribe((s, prev) => {
        if (s.activeDiagramId !== prev.activeDiagramId) soon();
      }),
      useThemeStore.subscribe(soon),
    ];
    window.addEventListener('resize', soon);
    return () => {
      for (const off of unsubscribe) off();
      window.removeEventListener('resize', soon);
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Click or drag: the view follows the pointer
  const goTo = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current;
    if (!layout) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = minimapToCanvas(layout, event.clientX - rect.left, event.clientY - rect.top);
    getCanvasController()?.centerOn?.(point);
  };

  return (
    <div
      className="absolute bottom-14 right-3 z-20 overflow-hidden rounded-lg border border-gray-200 bg-white/95 shadow-sm"
      data-testid="minimap"
    >
      <canvas
        ref={canvasRef}
        style={{ width: WIDTH, height: HEIGHT, touchAction: 'none' }}
        className="block cursor-pointer"
        role="img"
        aria-label="Overview of the diagram: click to move the view there"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          goTo(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) goTo(e);
        }}
      />
    </div>
  );
}
