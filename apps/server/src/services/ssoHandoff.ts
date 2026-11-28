import { createHash, randomBytes } from 'node:crypto';

/**
 * Handing a single sign-on to the web app. The provider sends the browser
 * back to the API, which can't simply set a cookie and redirect: where the
 * app and the API are different sites (Render), the app's requests don't
 * carry the API's cookies. So the API passes a one-time code to the app in
 * the address's fragment (never sent to servers or in Referer headers), and
 * the app trades it for a session like any sign-in.
 *
 * Codes last a minute and work once. Per process, like the other live state.
 */

const TTL_MS = 60_000;
const MAX_PENDING = 10_000;

const pending = new Map<string, { userId: string; expiresAt: number }>();

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

function prune(now: number): void {
  for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
}

/** A code for this sign-in, to put in the address the browser goes back to. */
export function createHandoff(userId: string, now = Date.now()): string {
  prune(now);
  // Under a flood, the oldest waiting sign-ins give way
  while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
  const code = randomBytes(32).toString('base64url');
  pending.set(hash(code), { userId, expiresAt: now + TTL_MS });
  return code;
}

/** Whose sign-in this code was, once; null if it's unknown, used or expired. */
export function redeemHandoff(code: string, now = Date.now()): string | null {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) return null;
  const key = hash(code);
  const entry = pending.get(key);
  if (!entry) return null;
  pending.delete(key);
  return entry.expiresAt > now ? entry.userId : null;
}
