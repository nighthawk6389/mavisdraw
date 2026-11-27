import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Small signed, expiring tokens for links sent by email (no table): a JSON
 * payload in base64url, HMAC'd with a key derived from the JWT secret and
 * the token's purpose, so a token for one purpose never works for another.
 */

export class SignedTokenError extends Error {}

const keyFor = (purpose: string) =>
  createHmac('sha256', config.jwtSecret).update(`signed-token:${purpose}`).digest();

export function signToken(
  purpose: string,
  data: Record<string, string>,
  ttlMs: number,
  now = Date.now(),
): string {
  const payload = Buffer.from(JSON.stringify({ ...data, x: now + ttlMs })).toString('base64url');
  const sig = createHmac('sha256', keyFor(purpose)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** The token's data, or SignedTokenError ('broken' or 'expired'). */
export function readToken(
  purpose: string,
  token: string,
  now = Date.now(),
): Record<string, string> {
  const broken = new SignedTokenError('broken');
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) throw broken;
  const expected = createHmac('sha256', keyFor(purpose)).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw broken;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw broken;
  }
  if (typeof data.x !== 'number') throw broken;
  if (data.x < now) throw new SignedTokenError('expired');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (k !== 'x' && typeof v === 'string') out[k] = v;
  return out;
}
