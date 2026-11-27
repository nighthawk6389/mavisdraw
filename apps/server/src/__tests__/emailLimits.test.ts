import { describe, it, expect, beforeEach } from 'vitest';
import { allowEmail, EMAIL_LIMITS, resetEmailLimits } from '../services/emailLimits.js';

const HOUR = 60 * 60 * 1000;

beforeEach(resetEmailLimits);

describe('email caps', () => {
  it('caps how many one person can make the server send', () => {
    const { max } = EMAIL_LIMITS.invite.perSender;
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
});
