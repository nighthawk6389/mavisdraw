import React, { useCallback, useMemo } from 'react';
import { useElementsStore, type AlignmentType, type DistributeDirection } from '../../stores/elementsStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUIStore } from '../../stores/uiStore';
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

export default function StylePanel() {
  const showStylePanel = useUIStore((s) => s.showStylePanel);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const elements = useElementsStore((s) => s.elements);
  const updateElement = useElementsStore((s) => s.updateElement);
  const alignElements = useElementsStore((s) => s.alignElements);
  const distributeElements = useElementsStore((s) => s.distributeElements);

  // Get selected elements
  const selectedElements = useMemo(() => {
    const result: MavisElement[] = [];
    for (const id of selectedIds) {
      const el = elements.get(id);
      if (el && !el.isDeleted) {
        result.push(el);
      }
    }
    return result;
  }, [selectedIds, elements]);

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

  const applyToAll = useCallback(
    (updates: Partial<MavisElement>) => {
      for (const el of selectedElements) {
        updateElement(el.id, updates);
      }
    },
    [selectedElements, updateElement],
  );

  const hasTextSelected = selectedElements.some((el) => el.type === 'text');
  const hasLinearSelected = selectedElements.some(
    (el) => el.type === 'arrow' || el.type === 'line',
  );

  if (!showStylePanel || selectedElements.length === 0) {
    return null;
  }

  const strokeColor = getCommonValue('strokeColor') ?? '#1e1e1e';
  const backgroundColor = getCommonValue('backgroundColor') ?? 'transparent';
  const fillStyle = getCommonValue('fillStyle') ?? 'none';
  const strokeWidth = getCommonValue('strokeWidth') ?? 2;
  const strokeStyle = getCommonValue('strokeStyle') ?? 'solid';
  const opacity = getCommonValue('opacity') ?? 100;
  const roughness = getCommonValue('roughness') ?? 1;

  return (
    <aside data-testid="style-panel" className="w-56 bg-white border-l border-gray-200 overflow-y-auto p-3 flex flex-col gap-3 z-10">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Style</h3>

      {/* Stroke Color */}
      <Section label="Stroke">
        <ColorPicker
          value={strokeColor}
          onChange={(color) => applyToAll({ strokeColor: color })}
        />
      </Section>

      {/* Background Color */}
      <Section label="Background">
        <ColorPicker
          value={backgroundColor}
          onChange={(color) => applyToAll({ backgroundColor: color })}
        />
      </Section>

      {/* Fill Style */}
      <Section label="Fill Style">
        <div className="flex gap-1">
          {FILL_STYLES.map((fs) => (
            <button
              key={fs.value}
              className={`px-2 py-1 text-xs rounded border ${
                fillStyle === fs.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => applyToAll({ fillStyle: fs.value })}
            >
              {fs.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Stroke Width */}
      <Section label="Stroke Width">
        <div className="flex gap-1">
          {STROKE_WIDTHS.map((sw) => (
            <button
              key={sw.value}
              className={`px-2 py-1 text-xs rounded border ${
                strokeWidth === sw.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => applyToAll({ strokeWidth: sw.value })}
            >
              {sw.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Stroke Style */}
      <Section label="Stroke Style">
        <div className="flex gap-1">
          {STROKE_STYLES.map((ss) => (
            <button
              key={ss.value}
              className={`px-2 py-1 text-xs rounded border font-mono ${
                strokeStyle === ss.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
              onClick={() => applyToAll({ strokeStyle: ss.value })}
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
          onChange={(e) => applyToAll({ opacity: parseInt(e.target.value, 10) })}
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
          onChange={(e) => applyToAll({ roughness: parseFloat(e.target.value) })}
          className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
      </Section>

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
                    onClick={() => {
                      for (const el of selectedElements) {
                        if (el.type === 'arrow' || el.type === 'line') {
                          updateElement(el.id, { routingMode: rm.value } as Partial<LinearElement>);
                        }
                      }
                    }}
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
                    onClick={() => {
                      for (const el of selectedElements) {
                        if (el.type === 'arrow' || el.type === 'line') {
                          updateElement(el.id, {
                            startArrowhead: ah.value,
                          } as Partial<LinearElement>);
                        }
                      }
                    }}
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
                    onClick={() => {
                      for (const el of selectedElements) {
                        if (el.type === 'arrow' || el.type === 'line') {
                          updateElement(el.id, {
                            endArrowhead: ah.value,
                          } as Partial<LinearElement>);
                        }
                      }
                    }}
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
                (selectedElements.find((el) => el.type === 'text') as TextElement | undefined)
                  ?.fontFamily ?? 'hand-drawn'
              }
              onChange={(e) => {
                for (const el of selectedElements) {
                  if (el.type === 'text') {
                    updateElement(el.id, {
                      fontFamily: e.target.value as FontFamily,
                    } as Partial<TextElement>);
                  }
                }
              }}
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
                (selectedElements.find((el) => el.type === 'text') as TextElement | undefined)
                  ?.fontSize ?? 20
              }
              onChange={(e) => {
                const size = parseInt(e.target.value, 10);
                if (isNaN(size)) return;
                for (const el of selectedElements) {
                  if (el.type === 'text') {
                    updateElement(el.id, { fontSize: size } as Partial<TextElement>);
                  }
                }
              }}
            />
          </Section>

          {/* Text Alignment */}
          <Section label="Alignment">
            <div className="flex gap-1">
              {TEXT_ALIGNS.map((ta) => {
                const currentAlign =
                  (selectedElements.find((el) => el.type === 'text') as TextElement | undefined)
                    ?.textAlign ?? 'left';
                return (
                  <button
                    key={ta.value}
                    className={`px-2 py-1 text-xs rounded border ${
                      currentAlign === ta.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                    onClick={() => {
                      for (const el of selectedElements) {
                        if (el.type === 'text') {
                          updateElement(el.id, {
                            textAlign: ta.value,
                          } as Partial<TextElement>);
                        }
                      }
                    }}
                  >
                    {ta.label}
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
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      {children}
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            className={`w-5 h-5 rounded border ${
              value === color ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200'
            }`}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            title={color}
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
        />
      </div>
      <div className="flex gap-1 items-center">
        <input
          type="color"
          value={value === 'transparent' ? '#ffffff' : value}
          onChange={(e) => onChange(e.target.value)}
          className="w-6 h-6 cursor-pointer border-0 p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 text-xs border border-gray-200 rounded px-1 py-0.5"
          placeholder="#hex"
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
