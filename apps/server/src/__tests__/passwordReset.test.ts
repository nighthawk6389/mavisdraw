import { describe, it, expect } from 'vitest';
import {
  createResetToken,
  passwordFingerprint,
  readResetToken,
  PasswordResetError,
} from '../services/passwordReset.js';
import { readToken, signToken, SignedTokenError } from '../services/signedToken.js';
import { passwordResetEmail } from '../services/mailer.js';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const MIN = 60 * 1000;
const user = { id: 'u1', passwordHash: '$2a$10$abcdefghijklmnopqrstuv' };

describe('password reset links', () => {
  it('name the account and the password they replace', () => {
    const token = createResetToken(user, NOW);
    expect(readResetToken(token, NOW + MIN)).toEqual({
      userId: 'u1',
      fingerprint: passwordFingerprint(user.passwordHash),
    });
  });

  it('last an hour', () => {
    const token = createResetToken(user, NOW);
    expect(() => readResetToken(token, NOW + 59 * MIN)).not.toThrow();
    expect(() => readResetToken(token, NOW + 61 * MIN)).toThrow(/expired/);
  });

  it('work once: the fingerprint changes with the password', () => {
    expect(passwordFingerprint('$2a$10$other')).not.toBe(passwordFingerprint(user.passwordHash));
    // An account with no password yet (e.g. signed up another way) gets one too
    expect(passwordFingerprint(null)).toMatch(/^[\w-]{22}$/);
  });

  it('can’t be edited to reset someone else’s password', () => {
    const [, sig] = createResetToken(user, NOW).split('.');
    const forged = Buffer.from(
      JSON.stringify({ u: 'admin', f: passwordFingerprint(null), x: NOW + 60 * MIN }),
    ).toString('base64url');
    expect(() => readResetToken(`${forged}.${sig}`, NOW)).toThrow(PasswordResetError);
    expect(() => readResetToken('garbage', NOW)).toThrow(/broken/);
  });

  it('are emailed with the link, saying what resetting does', () => {
    const e = passwordResetEmail({ to: 'a@example.com', link: 'https://x/reset?token=t' });
    expect(e.subject).toBe('Reset your MavisDraw password');
    expect(e.text).toContain('https://x/reset?token=t');
    expect(e.text).toContain('signs out every session');
  });
});

describe('signed tokens', () => {
  it('only work for the purpose they were made for', () => {
    const token = signToken('password-reset', { u: 'u1' }, MIN, NOW);
    expect(readToken('password-reset', token, NOW)).toEqual({ u: 'u1' });
    expect(() => readToken('email-verification', token, NOW)).toThrow(SignedTokenError);
  });

  it('reject extra parts and bad signatures', () => {
    const token = signToken('p', { u: 'u1' }, MIN, NOW);
    expect(() => readToken('p', `${token}.x`, NOW)).toThrow('broken');
    expect(() => readToken('p', `${token.slice(0, -2)}AA`, NOW)).toThrow('broken');
  });
});
