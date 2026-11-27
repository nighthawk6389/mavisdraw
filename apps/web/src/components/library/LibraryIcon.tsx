import { ICONS } from '@mavisdraw/export/library';

/** An icon from the library, as inline SVG. */
export function LibraryIcon({
  id,
  size = 20,
  color,
}: {
  id: string;
  size?: number;
  color?: string;
}) {
  const def = Object.prototype.hasOwnProperty.call(ICONS, id) ? ICONS[id] : null;
  if (!def) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {def.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
