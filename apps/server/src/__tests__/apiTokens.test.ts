import { describe, it, expect } from 'vitest';
import {
  displayPrefix,
  generateToken,
  hashToken,
  looksLikeToken,
} from '../services/apiTokenService.js';

describe('access tokens', () => {
  it('are long, random and recognisable', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.startsWith('mdw_')).toBe(true);
    expect(looksLikeToken(a)).toBe(true);
  });

  it('are stored only as a hash', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(4, 12));
    expect(hashToken(token)).toBe(hash);
  });

  it('show only a short prefix', () => {
    const token = generateToken();
    expect(displayPrefix(token)).toBe(token.slice(0, 8));
  });

  it('reject anything else before any lookup (e.g. a session JWT)', () => {
    expect(looksLikeToken('eyJhbGciOiJIUzI1NiJ9.e30.abc')).toBe(false);
    expect(looksLikeToken('mdw_short')).toBe(false);
    expect(looksLikeToken(`mdw_${'a'.repeat(43)}x`)).toBe(false);
  });
});
