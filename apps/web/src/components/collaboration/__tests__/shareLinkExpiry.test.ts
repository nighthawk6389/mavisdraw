import { describe, it, expect } from 'vitest';
import { LINK_LIFETIMES, describeExpiry, isExpired } from '../shareLinkExpiry';

const now = Date.parse('2026-11-28T12:00:00Z');
const inMs = (ms: number) => new Date(now + ms).toISOString();
const HOUR = 3600_000;

describe('share link expiry', () => {
  it('reads as people would say it', () => {
    expect(describeExpiry(null, now)).toBe('Never expires');
    expect(describeExpiry(inMs(7 * 24 * HOUR), now)).toBe('Expires in 7 days');
    expect(describeExpiry(inMs(6 * 24 * HOUR + HOUR), now)).toBe('Expires in 7 days');
    expect(describeExpiry(inMs(25 * HOUR), now)).toBe('Expires in 2 days');
    expect(describeExpiry(inMs(24 * HOUR), now)).toBe('Expires in 1 day');
    expect(describeExpiry(inMs(90 * 60_000), now)).toBe('Expires in 2 hours');
    expect(describeExpiry(inMs(10 * 60_000), now)).toBe('Expires in 1 hour');
    expect(describeExpiry(inMs(0), now)).toBe('Expired');
    expect(describeExpiry(inMs(-HOUR), now)).toBe('Expired');
  });

  it('knows an expired link from a live one', () => {
    expect(isExpired(null, now)).toBe(false);
    expect(isExpired(inMs(1), now)).toBe(false);
    expect(isExpired(inMs(0), now)).toBe(true);
  });

  it('offers a day, a week, a month, or never', () => {
    expect(LINK_LIFETIMES.map((l) => l.days)).toEqual([1, 7, 30, null]);
  });
});
