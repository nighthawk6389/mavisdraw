/**
 * Sockets still waiting to authenticate, per client address. Each one may
 * send a little before it authenticates (see app.ts); without a cap per
 * address, opening many sockets would multiply that allowance.
 */

export const MAX_WAITING_PER_ADDRESS = 50;

const waiting = new Map<string, number>();

/** Count a new socket from `address`: false if that's one too many waiting. */
export function admitWaiting(address: string): boolean {
  const n = waiting.get(address) ?? 0;
  if (n >= MAX_WAITING_PER_ADDRESS) return false;
  waiting.set(address, n + 1);
  return true;
}

/** It authenticated, or went away. */
export function releaseWaiting(address: string): void {
  const n = (waiting.get(address) ?? 0) - 1;
  if (n > 0) waiting.set(address, n);
  else waiting.delete(address);
}

/** For tests. */
export function waitingFrom(address: string): number {
  return waiting.get(address) ?? 0;
}
