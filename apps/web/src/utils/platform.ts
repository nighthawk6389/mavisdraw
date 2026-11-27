/** True on macOS / iOS, where shortcuts use ⌘ instead of Ctrl. */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/**
 * Human-readable shortcut label: `shortcut('Mod+Shift+]')` → "⌘⇧]" on Mac,
 * "Ctrl+Shift+]" elsewhere.
 */
export function shortcut(spec: string): string {
  const parts = spec.split('+');
  if (IS_MAC) {
    return parts
      .map((p) =>
        p === 'Mod' ? '⌘' : p === 'Shift' ? '⇧' : p === 'Alt' ? '⌥' : p === 'Delete' ? '⌫' : p,
      )
      .join('');
  }
  return parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)).join('+');
}
