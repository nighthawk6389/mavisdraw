import { afterEach, describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import {
  forgetRevocations,
  issuedTokenRevoked,
  revokeIssuedTokens,
} from '../services/accessRevocation.js';
import { verifyAccessToken } from '../services/authService.js';

/**
 * Taking an account back (a password reset, or the first SSO sign-in into an
 * unconfirmed account) must also stop access tokens already handed out: they
 * are checked without the database and would otherwise work for 15 minutes.
 */

afterEach(() => forgetRevocations());

describe('access tokens issued before an account was taken back', () => {
  it('are refused; tokens issued since are not', () => {
    revokeIssuedTokens('u1', 10_000);
    expect(issuedTokenRevoked('u1', { iatMs: 9_999 })).toBe(true);
    expect(issuedTokenRevoked('u1', { iatMs: 10_000 })).toBe(false);
    expect(issuedTokenRevoked('u1', { iatMs: 10_001 })).toBe(false);
    // Someone else's are untouched
    expect(issuedTokenRevoked('u2', { iatMs: 1 })).toBe(false);
  });

  it('a token from before ms issue times only has whole seconds, which errs towards refusing', () => {
    revokeIssuedTokens('u1', 10_500);
    expect(issuedTokenRevoked('u1', { iat: 10 })).toBe(true);
    expect(issuedTokenRevoked('u1', { iat: 11 })).toBe(false);
    expect(issuedTokenRevoked('u1', {})).toBe(true);
  });

  it('even within the same second as the takeover', () => {
    const now = Date.now();
    const squatters = jwt.sign({ userId: 'u1', email: 'a@b.c', iatMs: now - 5 }, config.jwtSecret);
    revokeIssuedTokens('u1', now);
    expect(() => verifyAccessToken(squatters)).toThrow('Invalid or expired access token');
    const owners = jwt.sign({ userId: 'u1', email: 'a@b.c', iatMs: now + 1 }, config.jwtSecret);
    expect(verifyAccessToken(owners).userId).toBe('u1');
  });

  it('are forgotten once every token they covered has expired', () => {
    revokeIssuedTokens('u1', 0);
    // Another revocation much later prunes the first
    revokeIssuedTokens('u2', 17 * 60 * 1000);
    expect(issuedTokenRevoked('u1', { iatMs: 1 })).toBe(false);
    expect(issuedTokenRevoked('u2', { iatMs: 1 })).toBe(true);
  });
});
