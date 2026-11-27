import { describe, it, expect } from 'vitest';
import {
  admitWaiting,
  MAX_WAITING_PER_ADDRESS,
  releaseWaiting,
  waitingFrom,
} from '../ws/preAuthLimit.js';

describe('sockets waiting to authenticate', () => {
  it('admits only so many at once from one address', () => {
    const a = '203.0.113.7';
    for (let i = 0; i < MAX_WAITING_PER_ADDRESS; i++) expect(admitWaiting(a)).toBe(true);
    expect(admitWaiting(a)).toBe(false);
    // Another address is unaffected
    expect(admitWaiting('198.51.100.1')).toBe(true);
    releaseWaiting('198.51.100.1');
    // One authenticates (or leaves): room for one more
    releaseWaiting(a);
    expect(admitWaiting(a)).toBe(true);
    for (let i = 0; i < MAX_WAITING_PER_ADDRESS; i++) releaseWaiting(a);
    expect(waitingFrom(a)).toBe(0);
    // Releasing more than were admitted never goes negative
    releaseWaiting(a);
    expect(waitingFrom(a)).toBe(0);
  });
});
