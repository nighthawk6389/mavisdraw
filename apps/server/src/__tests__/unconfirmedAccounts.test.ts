import { describe, it, expect, vi, beforeEach } from 'vitest';

const mail = vi.hoisted(() => ({ enabled: true }));
const deleted = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../services/mailer.js', () => ({ isMailEnabled: () => mail.enabled }));
vi.mock('../db/client.js', () => {
  const chain = {
    where: () => chain,
    returning: async () => {
      deleted.calls += 1;
      return [{ id: 'u1' }];
    },
  };
  return { db: { delete: () => chain } };
});

const { releaseAbandonedAddress, sweepAbandonedSignups, unconfirmedCutoff } =
  await import('../services/unconfirmedAccounts.js');

describe('abandoned sign-ups', () => {
  beforeEach(() => {
    mail.enabled = true;
    deleted.calls = 0;
  });

  it('count as abandoned after thirty days', () => {
    const now = Date.parse('2026-11-28T00:00:00Z');
    expect(unconfirmedCutoff(now).toISOString()).toBe('2026-10-29T00:00:00.000Z');
  });

  it('are left alone where the server sends no email (nobody could have confirmed)', async () => {
    mail.enabled = false;
    expect(await releaseAbandonedAddress('a@b.c')).toBe(false);
    expect(await sweepAbandonedSignups(Date.now() + 10 * 3600_000)).toBe(0);
    expect(deleted.calls).toBe(0);
  });

  it('free their address for a new sign-up', async () => {
    expect(await releaseAbandonedAddress('A@B.C')).toBe(true);
    expect(deleted.calls).toBe(1);
  });

  it('are swept at most hourly', async () => {
    const t = Date.now() + 100 * 3600_000;
    expect(await sweepAbandonedSignups(t)).toBe(1);
    expect(await sweepAbandonedSignups(t + 60_000)).toBe(0);
    expect(await sweepAbandonedSignups(t + 3600_000)).toBe(1);
    expect(deleted.calls).toBe(2);
  });
});
