import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LinearElement, MavisElement, Point, PortalElement, RoutingMode } from '@mavisdraw/types';
import { useSelectionStore } from '../../stores/selectionStore';
import { useElementsStore } from '../../stores/elementsStore';
import { useUIStore } from '../../stores/uiStore';
import { getCanvasController } from './canvasController';
import * as actions from '../../editor/actions';
import { shortcut } from '../../utils/platform';

export interface ContextMenuState {
  /** Position relative to the canvas container, in CSS pixels. */
  x: number;
  y: number;
  canvasPoint: Point;
  onElement: boolean;
}

type MenuItem =
  | {
      kind: 'item';
      id: string;
      label: string;
      hint?: string;
      checked?: boolean;
      danger?: boolean;
      run: () => void;
    }
  | { kind: 'separator'; id: string };

const ROUTING: { mode: RoutingMode; label: string }[] = [
  { mode: 'straight', label: 'Straight' },
  { mode: 'curved', label: 'Curved' },
  { mode: 'elbow', label: 'Elbow' },
];

function buildItems(
  selected: MavisElement[],
  canvasPoint: Point,
  renderMode: 'sketchy' | 'clean',
  showGrid: boolean,
): MenuItem[] {
  const items: MenuItem[] = [];
  const sep = (id: string) => items.push({ kind: 'separator', id });

  if (selected.length > 0) {
    const locked = selected.every((el) => el.isLocked);
    const single = selected.length === 1 ? selected[0] : null;

    if (single?.type === 'portal' && (single as PortalElement).targetDiagramId) {
      items.push({
        kind: 'item',
        id: 'open-portal',
        label: 'Open nested diagram',
        hint: 'Double-click',
        run: () => getCanvasController()?.openPortal?.(single.id),
      });
      sep('s-portal');
    }

    items.push(
      { kind: 'item', id: 'cut', label: 'Cut', hint: shortcut('Mod+X'), run: actions.cut },
      { kind: 'item', id: 'copy', label: 'Copy', hint: shortcut('Mod+C'), run: actions.copy },
      {
        kind: 'item',
        id: 'paste',
        label: 'Paste',
        hint: shortcut('Mod+V'),
        run: () => void actions.paste(canvasPoint),
      },
      {
        kind: 'item',
        id: 'duplicate',
        label: 'Duplicate',
        hint: shortcut('Mod+D'),
        run: actions.duplicate,
      },
      {
        kind: 'item',
        id: 'copy-png',
        label: 'Copy as PNG',
        hint: shortcut('Shift+Alt+C'),
        run: () => void actions.copySelectionAsPng(),
      },
    );
    sep('s-order');
    items.push(
      {
        kind: 'item',
        id: 'front',
        label: 'Bring to front',
        hint: shortcut('Mod+Shift+]'),
        run: () => actions.reorder('front'),
      },
      {
        kind: 'item',
        id: 'forward',
        label: 'Bring forward',
        hint: shortcut('Mod+]'),
        run: () => actions.reorder('forward'),
      },
      {
        kind: 'item',
        id: 'backward',
        label: 'Send backward',
        hint: shortcut('Mod+['),
        run: () => actions.reorder('backward'),
      },
      {
        kind: 'item',
        id: 'back',
        label: 'Send to back',
        hint: shortcut('Mod+Shift+['),
        run: () => actions.reorder('back'),
      },
    );

    if (single && (single.type === 'arrow' || single.type === 'line')) {
      sep('s-routing');
      const current = (single as LinearElement).routingMode;
      for (const r of ROUTING) {
        items.push({
          kind: 'item',
          id: `route-${r.mode}`,
          label: `${r.label} connector`,
          checked: current === r.mode,
          run: () => {
            const updates: Partial<LinearElement> = { routingMode: r.mode };
            const linear = single as LinearElement;
            if (linear.routingMode === 'elbow' && linear.elbowManualRoute) {
              updates.elbowManualRoute = false;
              updates.points = [linear.points[0], linear.points[linear.points.length - 1]];
            }
            useElementsStore.getState().updateElement(single.id, updates as Partial<MavisElement>);
          },
        });
      }
    }

    sep('s-structure');
    if (actions.canGroup()) {
      items.push({ kind: 'item', id: 'group', label: 'Group', hint: shortcut('Mod+G'), run: actions.group });
    }
    if (actions.canUngroup()) {
      items.push({
        kind: 'item',
        id: 'ungroup',
        label: 'Ungroup',
        hint: shortcut('Mod+Shift+G'),
        run: actions.ungroup,
      });
    }
    items.push({
      kind: 'item',
      id: 'lock',
      label: locked ? 'Unlock' : 'Lock',
      hint: shortcut('Mod+Shift+L'),
      run: actions.toggleLock,
    });
    sep('s-delete');
    items.push({
      kind: 'item',
      id: 'delete',
      label: 'Delete',
      hint: shortcut('Delete'),
      danger: true,
      run: actions.deleteSelection,
    });
  } else {
    items.push(
      {
        kind: 'item',
        id: 'paste',
        label: 'Paste',
        hint: shortcut('Mod+V'),
        run: () => void actions.paste(canvasPoint),
      },
      { kind: 'item', id: 'select-all', label: 'Select all', hint: shortcut('Mod+A'), run: actions.selectAll },
    );
    sep('s-view');
    items.push(
      { kind: 'item', id: 'fit', label: 'Zoom to fit', hint: shortcut('Shift+1'), run: actions.zoomToFit },
      {
        kind: 'item',
        id: 'grid',
        label: 'Show grid',
        checked: showGrid,
        run: () => useUIStore.getState().toggleGrid(),
      },
      {
        kind: 'item',
        id: 'sketchy',
        label: 'Hand-drawn style',
        checked: renderMode === 'sketchy',
        run: () =>
          useUIStore.getState().setRenderMode(renderMode === 'sketchy' ? 'clean' : 'sketchy'),
      },
      {
        kind: 'item',
        id: 'copy-png',
        label: 'Copy diagram as PNG',
        run: () => void actions.copySelectionAsPng(),
      },
    );
  }
  return items;
}

export default function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const elements = useElementsStore((s) => s.elements);
  const renderMode = useUIStore((s) => s.renderMode);
  const showGrid = useUIStore((s) => s.showGrid);

  const items = useMemo(() => {
    const selected = Array.from(selectedIds)
      .map((id) => elements.get(id))
      .filter((el): el is MavisElement => !!el && !el.isDeleted);
    return buildItems(selected, state.canvasPoint, renderMode, showGrid);
  }, [selectedIds, elements, state.canvasPoint, renderMode, showGrid]);

  // Keep the menu inside the canvas area
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const parent = menu?.offsetParent as HTMLElement | null;
    if (!menu || !parent) return;
    const maxLeft = parent.clientWidth - menu.offsetWidth - 8;
    const maxTop = parent.clientHeight - menu.offsetHeight - 8;
    setPosition({
      left: Math.max(8, Math.min(state.x, maxLeft)),
      top: Math.max(8, Math.min(state.y, maxTop)),
    });
  }, [state.x, state.y, items.length]);

  // Focus the first item for keyboard users; close on outside click / Escape
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };

  // Drop leading/trailing/double separators produced by conditional sections
  const visible = items.filter((item, i, arr) => {
    if (item.kind !== 'separator') return true;
    if (i === 0 || i === arr.length - 1) return false;
    return arr[i - 1].kind !== 'separator';
  });

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Canvas actions"
      data-testid="context-menu"
      onKeyDown={onMenuKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="absolute z-50 min-w-[220px] rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl"
      style={{ left: position.left, top: position.top }}
    >
      {visible.map((item) =>
        item.kind === 'separator' ? (
          <div key={item.id} role="separator" className="my-1 h-px bg-gray-100" />
        ) : (
          <button
            key={item.id}
            type="button"
            role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={item.checked}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-blue-50 focus:bg-blue-50 ${
              item.danger ? 'text-red-600' : 'text-gray-800'
            }`}
            onClick={() => {
              item.run();
              onClose();
              getCanvasController()?.invalidate();
            }}
          >
            <span className="w-4 text-blue-600" aria-hidden="true">
              {item.checked ? '✓' : ''}
            </span>
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="text-xs text-gray-400">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
