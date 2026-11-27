/**
 * When the canvas gets narrower (the inspector column opens beside it), how
 * far to scroll so the selection, visible before, isn't left under the
 * column. Positive moves the view's content left. 0 when nothing needs to
 * change, or when the selection was already off-screen or can't fit anyway.
 *
 * Screen coordinates: the selection's left/right edges relative to the
 * canvas's left side.
 */
export function shiftToKeepInView(
  selection: { left: number; right: number },
  oldWidth: number,
  newWidth: number,
  margin = 24,
): number {
  if (newWidth >= oldWidth) return 0;
  // Not on screen before: the person wasn't looking at it
  if (selection.left >= oldWidth || selection.right <= 0) return 0;
  const overflow = selection.right - (newWidth - margin);
  if (overflow <= 0) return 0;
  // Move it left, but never push its left edge off the canvas
  const room = Math.max(0, selection.left - margin);
  return Math.min(overflow, room);
}
