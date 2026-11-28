import { describe, it, expect, beforeEach } from 'vitest';
import { allowEmail, EMAIL_LIMITS, resetEmailLimits } from '../services/emailLimits.js';

const HOUR = 60 * 60 * 1000;

beforeEach(resetEmailLimits);

describe('email caps', () => {
  it('caps how many one person can make the server send', () => {
    const { max } = EMAIL_LIMITS.invite.perSender!;
    const t = Date.now();
    for (let i = 0; i < max; i++)
      expect(allowEmail('invite', 'spammer', `p${i}@x.test`, t)).toBe(true);
    expect(allowEmail('invite', 'spammer', 'one-more@x.test', t)).toBe(false);
    // Someone else is unaffected, and the window rolls on
    expect(allowEmail('invite', 'colleague', 'one-more@x.test', t)).toBe(true);
    expect(allowEmail('invite', 'spammer', 'later@x.test', t + HOUR)).toBe(true);
  });

  it('caps how many one inbox gets, from everyone together, whatever the case', () => {
    const { max, ms } = EMAIL_LIMITS.invite.perRecipient;
    const t = Date.now();
    for (let i = 0; i < max; i++) {
      expect(allowEmail('invite', `sender${i}`, i % 2 ? 'Ana@Acme.test' : 'ana@acme.test', t)).toBe(
        true,
      );
    }
    expect(allowEmail('invite', 'another', 'ANA@acme.test', t)).toBe(false);
    expect(allowEmail('invite', 'another', 'ana@acme.test', t + ms)).toBe(true);
  });

  it('a refused email is not counted, and kinds are counted apart', () => {
    const { max } = EMAIL_LIMITS.mention.perRecipient;
    const t = Date.now();
    for (let i = 0; i < max; i++) allowEmail('mention', `s${i}`, 'busy@x.test', t);
    expect(allowEmail('mention', 'new', 'busy@x.test', t)).toBe(false);
    // The refusal didn't use up "new"'s own allowance or block other kinds
    expect(allowEmail('mention', 'new', 'quiet@x.test', t)).toBe(true);
    expect(allowEmail('invite', 'new', 'busy@x.test', t)).toBe(true);
  });

  it('one inbox gets only a few reset or confirmation links a day, however many clients ask', () => {
    const t = Date.now();
    for (const kind of ['reset', 'verify'] as const) {
      const { max } = EMAIL_LIMITS[kind].perRecipient;
      for (let i = 0; i < max; i++) {
        expect(allowEmail(kind, `10.0.0.${i}`, 'target@x.test', t)).toBe(true);
      }
      expect(allowEmail(kind, '10.0.1.1', 'TARGET@x.test', t + 60 * 60 * 1000)).toBe(false);
      // A day later, again
      expect(allowEmail(kind, '10.0.1.1', 'target@x.test', t + 25 * 60 * 60 * 1000)).toBe(true);
    }
  });

  it('confirmation links are capped per inbox only (an office signs many people up)', () => {
    const t = Date.now();
    for (let i = 0; i < 100; i++) {
      expect(allowEmail('verify', '10.8.8.8', `hire${i}@x.test`, t)).toBe(true);
    }
  });

  it('one client can’t spray reset links across many inboxes', () => {
    const t = Date.now();
    const { max } = EMAIL_LIMITS.reset.perSender!;
    for (let i = 0; i < max; i++) allowEmail('reset', '10.9.9.9', `p${i}@x.test`, t);
    expect(allowEmail('reset', '10.9.9.9', 'one-more@x.test', t)).toBe(false);
  });
});
