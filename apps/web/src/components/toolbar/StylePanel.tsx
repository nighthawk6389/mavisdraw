import React, { useCallback, useMemo } from 'react';
import { useElementsStore, type AlignmentType, type DistributeDirection } from '../../stores/elementsStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
import { ICONS } from '@mavisdraw/export/library';
import { LibraryIcon } from '../library/LibraryIcon';
import type {
  MavisElement,
  FillStyle,
  StrokeStyle,
  FontFamily,
  TextAlign,
  TextElement,
  LinearElement,
  RoutingMode,
  Arrowhead,
  VerticalAlign,
} from '@mavisdraw/types';

const PRESET_COLORS = [
  '#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00',
  '#7048e8', '#0c8599', '#e64980', '#868e96', '#ffffff',
];

const FILL_STYLES: { value: FillStyle; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'hachure', label: 'Hachure' },
  { value: 'cross-hatch', label: 'Cross' },
];

const STROKE_STYLES: { value: StrokeStyle; label: string }[] = [
  { value: 'solid', label: '\u2500\u2500\u2500' },
  { value: 'dashed', label: '- - -' },
  { value: 'dotted', label: '...' },
];

const STROKE_WIDTHS: { value: number; label: string }[] = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Normal' },
  { value: 4, label: 'Bold' },
];

const FONT_FAMILIES: { value: FontFamily; label: string }[] = [
  { value: 'hand-drawn', label: 'Hand-drawn' },
  { value: 'sans-serif', label: 'Sans-serif' },
  { value: 'monospace', label: 'Monospace' },
];

const TEXT_ALIGNS: { value: TextAlign; label: string }[] = [
  { value: 'left', label: '\u2261L' },
  { value: 'center', label: '\u2261C' },
  { value: 'right', label: '\u2261R' },
];

const VERTICAL_ALIGNS: { value: VerticalAlign; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
];

const ROUTING_MODES: { value: RoutingMode; label: string }[] = [
  { value: 'straight', label: 'Straight' },
  { value: 'curved', label: 'Curved' },
  { value: 'elbow', label: 'Elbow' },
];

const ARROWHEAD_OPTIONS: { value: Arrowhead; label: string; icon: string }[] = [
  { value: 'none', label: 'None', icon: '—' },
  { value: 'arrow', label: 'Arrow', icon: '→' },
  { value: 'triangle', label: 'Triangle', icon: '▶' },
  { value: 'dot', label: 'Dot', icon: '●' },
  { value: 'bar', label: 'Bar', icon: '|' },
];

/**
 * `header`: shown above the style controls (the component the selected shape
 * shows), so one column describes the selection.
 */
/** Shapes that can show an icon. */
const ICON_SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'cylinder', 'queue', 'portal']);

/** The icons, by label, for the picker. */
const ICON_OPTIONS = Object.entries(ICONS)
  .map(([id, def]) => [id, def.label] as const)
  .sort((a, b) => a[1].localeCompare(b[1]));

/** Fields that change while shapes move or resize: nothing in the panel shows them. */
const GEOMETRY = new Set(['x', 'y', 'width', 'height', 'points', 'angle', 'version', 'updatedAt']);

const omitGeometry = (key: string, value: unknown) => (GEOMETRY.has(key) ? undefined : value);

/** Same object, or the same in everything but geometry (fields compared by reference). */
function sameButGeometry(a: MavisElement, b: MavisElement): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  const ar = a as unknown as Record<string, unknown>;
  const br = b as unknown as Record<string, unknown>;
  for (const k of ak) if (!GEOMETRY.has(k) && ar[k] !== br[k]) return false;
  return true;
}

/** Each element's style string, kept while only its geometry changes (a drag). */
const styleStrings = new Map<string, { el: MavisElement; key: string }>();

function styleString(el: MavisElement | undefined): string {
  if (!el) return 'null';
  const cached = styleStrings.get(el.id);
  if (cached && sameButGeometry(cached.el, el)) {
    cached.el = el;
    return cached.key;
  }
  if (styleStrings.size > 20_000) styleStrings.clear();
  const key = JSON.stringify(el, omitGeometry);
  styleStrings.set(el.id, { el, key });
  return key;
}

let lastParts: string[] = [];
let lastKey = '';

/**
 * What the panel shows of the selection (and the labels inside it), as one
 * string: everything but geometry. A selector that returns it changes only
 * when the panel has something new to show. Dragging a big selection costs
 * a reference comparison per shape, not a JSON pass over all of them.
 */
export function selectionStyleKey(
  elements: Map<string, MavisElement>,
  selectedIds: Set<string>,
): string {
  const parts: string[] = [];
  for (const id of selectedIds) {
    const el = elements.get(id);
    if (!el) continue;
    parts.push(styleString(el));
    for (const b of el.boundElements) {
      if (b.type === 'text') parts.push(styleString(elements.get(b.id)));
    }
  }
  if (parts.length === lastParts.length && parts.every((p, i) => p === lastParts[i])) {
    return lastKey;
  }
  lastParts = parts;
  lastKey = parts.join('\n');
  return lastKey;
}

export default function StylePanel({ header }: { header?: React.ReactNode } = {}) {
  const showStylePanel = useUIStore((s) => s.showStylePanel);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const settledSelectedIds = useSelectionStore((s) => s.settledSelectedIds);
  // Not the whole elements map: a drag changes it every frame, and the panel
  // shows nothing of where shapes are, only how they look
  const styleKey = useElementsStore((s) => selectionStyleKey(s.elements, selectedIds));
  const alignElements = useElementsStore((s) => s.alignElements);
  const distributeElements = useElementsStore((s) => s.distributeElements);

  // Get selected elements (read again whenever what the panel shows changes)
  const selectedElements = useMemo(() => {
    const elements = useElementsStore.getState().elements;
    const result: MavisElement[] = [];
    for (const id of selectedIds) {
      const el = elements.get(id);
      if (el && !el.isDeleted) {
        result.push(el);
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- styleKey: what the panel shows changed
  }, [selectedIds, styleKey]);

  // Get common property values from selection
  const getCommonValue = useCallback(
    <K extends keyof MavisElement>(key: K): MavisElement[K] | null => {
      if (selectedElements.length === 0) return null;
      const first = selectedElements[0][key];
      const allSame = selectedElements.every((el) => el[key] === first);
      return allSame ? first : null;
    },
    [selectedElements],
  );

  // One undo step per change; continuous edits (sliders, colour drags)
  // with the same key merge into a single step.
  const selectionKey = useMemo(() => Array.from(selectedIds).sort().join(','), [selectedIds]);

  // Per-element updates fired by one control interaction share an undo step
  const updateElement = useCallback(
    (id: string, updates: Partial<MavisElement>) => {
      const store = useElementsStore.getState();
      store.pushHistory(`panel:${selectionKey}`);
      store.updateElementSilent(id, updates);
    },
    [selectionKey],
  );

  const applyToAll = useCallback(
    (updates: Partial<MavisElement>, coalesce?: string) => {
      const store = useElementsStore.getState();
      store.pushHistory(coalesce ? `${coalesce}:${selectionKey}` : undefined);
      // One store update for the whole selection (it used to be one per shape)
      store.updateElementsSilent(selectedElements.map((el) => ({ id: el.id, changes: updates })));
    },
    [selectedElements, selectionKey],
  );

  // Text styling applies to selected text and to labels inside selected shapes
  const textTargets = useMemo(() => {
    const elements = useElementsStore.getState().elements;
    const result: TextElement[] = [];
    const seen = new Set<string>();
    for (const el of selectedElements) {
      const candidates: (MavisElement | undefined)[] =
        el.type === 'text'
          ? [el]
          : el.boundElements.filter((b) => b.type === 'text').map((b) => elements.get(b.id));
      for (const c of candidates) {
        if (c && c.type === 'text' && !c.isDeleted && !seen.has(c.id)) {
          seen.add(c.id);
          result.push(c);
        }
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- styleKey covers the labels too
  }, [selectedElements, styleKey]);

  const applyToText = useCallback(
    (updates: Partial<TextElement>, coalesce?: string) => {
      const store = useElementsStore.getState();
      store.pushHistory(coalesce ? `${coalesce}:${selectionKey}` : undefined);
      store.updateElementsSilent(
        textTargets.map((el) => ({ id: el.id, changes: updates as Partial<MavisElement> })),
      );
    },
    [textTargets, selectionKey],
  );

  // Connector-only settings (routing, arrowheads) for the selected lines and arrows
  const applyToLinear = useCallback(
    (updates: Partial<LinearElement>) => {
      const store = useElementsStore.getState();
      store.pushHistory(`panel:${selectionKey}`);
      store.updateElementsSilent(
        selectedElements
          .filter((el) => el.type === 'arrow' || el.type === 'line')
          .map((el) => ({ id: el.id, changes: updates as Partial<MavisElement> })),
      );
    },
    [selectedElements, selectionKey],
  );

  const hasTextSelected = textTargets.length > 0;
  const hasShapeSelected = selectedElements.some((el) => ICON_SHAPES.has(el.type));
  const hasLinearSelected = selectedElements.some(
    (el) => el.type === 'arrow' || el.type === 'line',
  );

  if (!showStylePanel || selectedElements.length === 0 || settledSelectedIds.size === 0) {
    return null;
  }

  const strokeColor = getCommonValue('strokeColor') ?? '#1e1e1e';
  const backgroundColor = getCommonValue('backgroundColor') ?? 'transparent';
  const fillStyle = getCommonValue('fillStyle') ?? 'none';
  const strokeWidth = getCommonValue('strokeWidth') ?? 2;
  const strokeStyle = getCommonValue('strokeStyle') ?? 'solid';
  const opacity = getCommonValue('opacity') ?? 100;
  const roughness = getCommonValue('roughness') ?? 1;
  const icon = getCommonValue('icon') ?? '';

  return (
    <aside data-testid="style-panel" aria-label="Style" className="w-56 bg-white border-l border-gray-200 overflow-y-auto p-3 flex flex-col gap-3 z-10">
      {header}
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Style</h3>

      {/* Stroke Color */}
      <Section label="Stroke">
        <ColorPicker
          label="Stroke colour"
          value={strokeColor}
          onChange={(color) => applyToAll({ strokeColor: color }, 'strokeColor')}
        />
      </Section>

      {/* Background Color */}
      <Section label="Background">
        <ColorPicker
          label="Background colour"
          value={backgroundColor}
          onChange={(color) => applyToAll({ backgroundColor: color }, 'backgroundColor')}
        />
      </Section>

      {/* Fill Style */}
      <Section label="Fill Style">
        <div className="flex flex-wrap gap-1">
          {FILL_STYLES.map((fs) => (
            <button
              key={fs.value}
              className={`px-2 py-1 text-xs rounded border ${
                fillStyle === fs.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => applyToAll({ fillStyle: fs.value })}
              aria-pressed={fillStyle === fs.value}
            >
              {fs.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Stroke Width */}
      <Section label="Stroke Width">
        <div className="flex flex-wrap gap-1">
          {STROKE_WIDTHS.map((sw) => (
            <button
              key={sw.value}
              className={`px-2 py-1 text-xs rounded border ${
                strokeWidth === sw.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => applyToAll({ strokeWidth: sw.value })}
              aria-pressed={strokeWidth === sw.value}
            >
              {sw.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 mt-1">
          <button
            className="w-7 h-7 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            onClick={() => applyToAll({ strokeWidth: Math.max(1, (strokeWidth as number) - 1) })}
            aria-label="Thinner"
          >
            &minus;
          </button>
          <span className="text-xs text-gray-600 w-6 text-center">{strokeWidth}</span>
          <button
            className="w-7 h-7 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
            onClick={() => applyToAll({ strokeWidth: Math.min(20, (strokeWidth as number) + 1) })}
            aria-label="Thicker"
          >
            +
          </button>
        </div>
      </Section>

      {/* Stroke Style */}
      <Section label="Stroke Style">
        <div className="flex flex-wrap gap-1">
          {STROKE_STYLES.map((ss) => (
            <button
              key={ss.value}
              className={`px-2 py-1 text-xs rounded border font-mono ${
                strokeStyle === ss.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => applyToAll({ strokeStyle: ss.value })}
              aria-pressed={strokeStyle === ss.value}
            >
              {ss.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Opacity */}
      <Section label={`Opacity: ${opacity}%`}>
        <input
          type="range"
          min="0"
          max="100"
          value={opacity}
          onChange={(e) => applyToAll({ opacity: parseInt(e.target.value, 10) }, 'opacity')}
          aria-label="Opacity"
          className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </Section>

      {/* Roughness */}
      <Section label={`Roughness: ${roughness}`}>
        <input
          type="range"
          min="0"
          max="3"
          step="0.5"
          value={roughness}
          onChange={(e) => applyToAll({ roughness: parseFloat(e.target.value) }, 'roughness')}
          aria-label="Roughness"
          className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </Section>

      {/* Icon (shapes only): a datastore's, a service's, a cloud product's */}
      {hasShapeSelected && (
        <Section label="Icon">
          <div className="flex items-center gap-2">
            {icon && <LibraryIcon id={icon} size={18} color={strokeColor} />}
            <select
              data-testid="icon-select"
              value={icon}
              onChange={(e) => applyToAll({ icon: e.target.value } as Partial<MavisElement>)}
              className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5 text-xs"
            >
              <option value="">None</option>
              {ICON_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </Section>
      )}

      {hasLinearSelected && (
        <>
          <Section label="Arrow Routing">
            <div className="flex gap-1">
              {ROUTING_MODES.map((rm) => {
                const linearEl = selectedElements.find(
                  (el) => el.type === 'arrow' || el.type === 'line',
                ) as LinearElement | undefined;
                const currentRouting = linearEl?.routingMode ?? 'straight';
                return (
                  <button
                    key={rm.value}
                    className={`px-2 py-1 text-xs rounded border ${
                      currentRouting === rm.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => applyToLinear({ routingMode: rm.value })}
                  >
                    {rm.label}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section label="Start Arrowhead">
            <div className="flex gap-1">
              {ARROWHEAD_OPTIONS.map((ah) => {
                const linearEl = selectedElements.find(
                  (el) => el.type === 'arrow' || el.type === 'line',
                ) as LinearElement | undefined;
                const current = linearEl?.startArrowhead ?? 'none';
                return (
                  <button
                    key={ah.value}
                    className={`w-7 h-7 text-xs rounded border flex items-center justify-center ${
                      current === ah.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => applyToLinear({ startArrowhead: ah.value })}
                    title={ah.label}
                  >
                    {ah.icon}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section label="End Arrowhead">
            <div className="flex gap-1">
              {ARROWHEAD_OPTIONS.map((ah) => {
                const linearEl = selectedElements.find(
                  (el) => el.type === 'arrow' || el.type === 'line',
                ) as LinearElement | undefined;
                const current = linearEl?.endArrowhead ?? 'none';
                return (
                  <button
                    key={ah.value}
                    className={`w-7 h-7 text-xs rounded border flex items-center justify-center ${
                      current === ah.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => applyToLinear({ endArrowhead: ah.value })}
                    title={ah.label}
                  >
                    {ah.icon}
                  </button>
                );
              })}
            </div>
          </Section>
        </>
      )}

      {/* Font Controls */}
      {hasTextSelected && (
        <>
          <div className="w-full h-px bg-gray-200" />
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Text</h3>

          {/* Font Family */}
          <Section label="Font">
            <select
              className="w-full text-xs border border-gray-200 rounded px-2 py-1"
              value={
                textTargets[0]?.fontFamily ?? 'hand-drawn'
              }
              onChange={(e) => applyToText({ fontFamily: e.target.value as FontFamily })}
            >
              {FONT_FAMILIES.map((ff) => (
                <option key={ff.value} value={ff.value}>
                  {ff.label}
                </option>
              ))}
            </select>
          </Section>

          {/* Font Size */}
          <Section label="Size">
            <input
              type="number"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1"
              min="8"
              max="200"
              value={
                textTargets[0]?.fontSize ?? 20
              }
              onChange={(e) => {
                const size = parseInt(e.target.value, 10);
                if (isNaN(size)) return;
                applyToText({ fontSize: size }, 'fontSize');
              }}
            />
          </Section>

          {/* Text Alignment */}
          <Section label="Alignment">
            <div className="text-xs text-gray-500 mb-0.5">Horizontal</div>
            <div className="flex gap-1 mb-2">
              {TEXT_ALIGNS.map((ta) => {
                // Selected text, or the labels inside selected shapes
                const currentAlign = textTargets[0]?.textAlign ?? 'left';
                return (
                  <button
                    key={ta.value}
                    className={`px-2 py-1 text-xs rounded border ${
                      currentAlign === ta.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => applyToText({ textAlign: ta.value })}
                  >
                    {ta.label}
                  </button>
                );
              })}
            </div>
            <div className="text-xs text-gray-500 mb-0.5">Vertical</div>
            <div className="flex gap-1">
              {VERTICAL_ALIGNS.map((va) => {
                const currentVertical = textTargets[0]?.verticalAlign ?? 'top';
                return (
                  <button
                    key={va.value}
                    className={`px-2 py-1 text-xs rounded border ${
                      currentVertical === va.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => applyToText({ verticalAlign: va.value })}
                  >
                    {va.label}
                  </button>
                );
              })}
            </div>
          </Section>
        </>
      )}

      {/* Alignment Tools */}
      {selectedElements.length >= 2 && (
        <>
          <div className="w-full h-px bg-gray-200" />
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Align
          </h3>

          <div className="grid grid-cols-3 gap-1">
            <AlignButton
              label="Left"
              icon={'\u25C0'}
              onClick={() =>
                alignElements(Array.from(selectedIds), 'left')
              }
            />
            <AlignButton
              label="Center H"
              icon={'\u2502'}
              onClick={() =>
                alignElements(Array.from(selectedIds), 'center-horizontal')
              }
            />
            <AlignButton
              label="Right"
              icon={'\u25B6'}
              onClick={() =>
                alignElements(Array.from(selectedIds), 'right')
              }
            />
            <AlignButton
              label="Top"
              icon={'\u25B2'}
              onClick={() =>
                alignElements(Array.from(selectedIds), 'top')
              }
            />
            <AlignButton
              label="Center V"
              icon={'\u2500'}
              onClick={() =>
                alignElements(Array.from(selectedIds), 'center-vertical')
              }
            />
            <AlignButton
              label="Bottom"
              icon={'\u25BC'}
              onClick={() =>
                alignElements(Array.from(selectedIds), 'bottom')
              }
            />
          </div>

          {selectedElements.length >= 3 && (
            <>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-1">
                Distribute
              </h3>
              <div className="flex gap-1">
                <button
                  className="flex-1 px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                  onClick={() =>
                    distributeElements(Array.from(selectedIds), 'horizontal')
                  }
                >
                  Horizontal
                </button>
                <button
                  className="flex-1 px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                  onClick={() =>
                    distributeElements(Array.from(selectedIds), 'vertical')
                  }
                >
                  Vertical
                </button>
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={label}>
      <span className="text-xs text-gray-500">{label}</span>
      {children}
    </div>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            className={`mavis-color w-5 h-5 rounded border ${
              value === color ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200'
            }`}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            title={color}
            aria-label={`${label} ${color}`}
            aria-pressed={value === color}
          />
        ))}
        <button
          className={`w-5 h-5 rounded border ${
            value === 'transparent'
              ? 'border-blue-500 ring-1 ring-blue-300'
              : 'border-gray-200'
          }`}
          style={{
            background:
              'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)',
            backgroundSize: '6px 6px',
            backgroundPosition: '0 0, 3px 3px',
          }}
          onClick={() => onChange('transparent')}
          title="Transparent"
          aria-label={`${label}: transparent`}
          aria-pressed={value === 'transparent'}
        />
      </div>
      <div className="flex gap-1 items-center">
        <input
          type="color"
          value={value === 'transparent' ? '#ffffff' : value}
          onChange={(e) => onChange(e.target.value)}
          className="mavis-color w-6 h-6 cursor-pointer border-0 p-0"
          aria-label={`${label}: pick any`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 text-xs border border-gray-200 rounded px-1 py-0.5"
          placeholder="#hex"
          aria-label={`${label} (hex)`}
        />
      </div>
    </div>
  );
}

function AlignButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      className="px-1 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center"
      onClick={onClick}
      title={label}
    >
      {icon}
    </button>
  );
}
