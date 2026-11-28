import { describe, it, expect } from 'vitest';
import { shareLinkOpen } from '../services/sharingService.js';

describe('share link expiry', () => {
  const now = Date.parse('2026-11-28T12:00:00Z');

  it('a link without an expiry always lets people join', () => {
    expect(shareLinkOpen(null, now)).toBe(true);
  });

  it('a link lets people join until the moment it expires', () => {
    expect(shareLinkOpen(new Date(now + 1), now)).toBe(true);
    expect(shareLinkOpen(new Date(now), now)).toBe(false);
    expect(shareLinkOpen(new Date(now - 60_000), now)).toBe(false);
  });
});
