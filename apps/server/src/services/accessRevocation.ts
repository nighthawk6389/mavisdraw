/**
 * Access tokens (15-minute JWTs) are checked without the database, so ending
 * an account's sessions doesn't stop the access tokens already handed out.
 * When an account is taken back, every access token it was issued before
 * that moment is refused here until it would have expired anyway.
 *
 * Per process, like the other live state (rooms, rate limits). A restart
 * forgets, but then only tokens minted in the 15 minutes before it are still
 * usable, and only until they expire.
 */

/** A little over the access token lifetime, so entries outlive every token they cover. */
const KEEP_MS = 16 * 60 * 1000;

/** userId → the moment (ms) before which its access tokens are refused. */
const revokedBefore = new Map<string, number>();

function prune(now: number): void {
  for (const [userId, at] of revokedBefore) {
    if (now - at > KEEP_MS) revokedBefore.delete(userId);
  }
}

/** Refuse every access token this account was issued until now. */
export function revokeIssuedTokens(userId: string, now = Date.now()): void {
  prune(now);
  revokedBefore.set(userId, now);
}

/**
 * Was this token issued before its account was taken back? Tokens carry
 * their issue time in ms (`iatMs`); older ones only the JWT's whole-second
 * `iat`, which can only make them look older than they are.
 */
export function issuedTokenRevoked(
  userId: string,
  issued: { iatMs?: number; iat?: number },
): boolean {
  const at = revokedBefore.get(userId);
  if (at === undefined) return false;
  const issuedMs = issued.iatMs ?? (issued.iat ?? 0) * 1000;
  return issuedMs < at;
}

/** For tests. */
export function forgetRevocations(): void {
  revokedBefore.clear();
}
