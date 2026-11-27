import { describe, it, expect } from 'vitest';
import {
  createVerificationToken,
  readVerificationToken,
  VerificationError,
} from '../services/emailVerification.js';
import { verifyEmail } from '../services/mailer.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('email confirmation links', () => {
  it('carry who and which address they confirm', () => {
    const token = createVerificationToken('user-1', 'ana@example.com', NOW);
    expect(readVerificationToken(token, NOW + 1000)).toEqual({
      userId: 'user-1',
      email: 'ana@example.com',
    });
  });

  it('expire after three days', () => {
    const token = createVerificationToken('user-1', 'ana@example.com', NOW);
    expect(() => readVerificationToken(token, NOW + 3 * DAY - 1)).not.toThrow();
    expect(() => readVerificationToken(token, NOW + 3 * DAY + 1)).toThrow(/expired/);
  });

  it('can’t be edited to confirm another address or account', () => {
    const token = createVerificationToken('user-1', 'ana@example.com', NOW);
    const [, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ u: 'user-1', e: 'boss@example.com', x: NOW + DAY }),
    ).toString('base64url');
    expect(() => readVerificationToken(`${forged}.${sig}`, NOW)).toThrow(VerificationError);
    // Nor made to last forever
    const longer = Buffer.from(
      JSON.stringify({ u: 'user-1', e: 'ana@example.com', x: NOW + 1000 * DAY }),
    ).toString('base64url');
    expect(() => readVerificationToken(`${longer}.${sig}`, NOW)).toThrow(VerificationError);
  });

  it('reject garbage without crashing', () => {
    for (const bad of [
      '',
      'abc',
      'abc.',
      '.abc',
      'a.b.c',
      `${'x'.repeat(500)}.${'y'.repeat(43)}`,
    ]) {
      expect(() => readVerificationToken(bad, NOW)).toThrow(VerificationError);
    }
  });

  it('are emailed with the link and what waits on it', () => {
    const e = verifyEmail({
      to: 'ana@example.com',
      name: 'Ana <script>',
      link: 'https://app.example.com/verify-email?token=t',
    });
    expect(e.subject).toBe('Confirm your email for MavisDraw');
    expect(e.text).toContain('https://app.example.com/verify-email?token=t');
    expect(e.html).toContain('Ana &lt;script&gt;');
  });
});
