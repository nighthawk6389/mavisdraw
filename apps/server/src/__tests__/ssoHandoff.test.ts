import { describe, it, expect } from 'vitest';
import { createHandoff, redeemHandoff } from '../services/ssoHandoff.js';

/** The one-time code that carries a single sign-on from the API to the web app. */
describe('single sign-on handoff codes', () => {
  it('work once, for the person who signed in', () => {
    const code = createHandoff('u1');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(redeemHandoff(code)).toBe('u1');
    expect(redeemHandoff(code)).toBeNull();
  });

  it('expire after a minute', () => {
    const now = Date.now();
    const code = createHandoff('u2', now);
    expect(redeemHandoff(code, now + 61_000)).toBeNull();
  });

  it('refuse anything else', () => {
    expect(redeemHandoff('')).toBeNull();
    expect(redeemHandoff('x'.repeat(43))).toBeNull();
    expect(redeemHandoff({} as unknown as string)).toBeNull();
  });
});
