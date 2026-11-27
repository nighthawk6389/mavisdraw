/**
 * One writer at a time per diagram, within this process: whoever reads a
 * diagram's stored contents to change them (a save with no live room, a
 * version restore, a rename) or to open a live room holds its lock, so
 * nobody else reads the state from before that write and saves it back.
 *
 * The server runs as a single process (see BACKLOG.md); the row lock taken
 * inside (`SELECT … FOR UPDATE`) also covers an overlap during a deploy.
 */

const tails = new Map<string, Promise<void>>();

export async function withDiagramLock<T>(diagramId: string, fn: () => Promise<T>): Promise<T> {
  const before = tails.get(diagramId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  const tail = before.then(() => mine);
  tails.set(diagramId, tail);
  await before;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(diagramId) === tail) tails.delete(diagramId);
  }
}

/** Whether anyone holds or waits for this diagram's lock (for tests). */
export function isDiagramLocked(diagramId: string): boolean {
  return tails.has(diagramId);
}
