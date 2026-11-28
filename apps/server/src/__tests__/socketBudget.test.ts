import { describe, it, expect } from 'vitest';
import { PendingBudget, documentNameOf, messageBytes } from '../ws/socketBudget.js';

/** A Hocuspocus message: the document name (varUint length + UTF-8), then the rest. */
function message(name: string, rest: Uint8Array = new Uint8Array([0, 1, 2])): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const length: number[] = [];
  let n = nameBytes.length;
  while (n >= 0x80) {
    length.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  length.push(n);
  return new Uint8Array([...length, ...nameBytes, ...rest]);
}

describe('reading which document a message is for', () => {
  it('reads the name, short or long (multi-byte length)', () => {
    expect(documentNameOf(message('diagram:abc'))).toBe('diagram:abc');
    const long = `diagram:${'x'.repeat(200)}`;
    expect(documentNameOf(message(long))).toBe(long);
    expect(documentNameOf(message('diagram:ünïcode'))).toBe('diagram:ünïcode');
  });

  it('gives up on anything that isn’t a sensible name', () => {
    expect(documentNameOf(new Uint8Array([]))).toBeNull();
    // Says 10 bytes follow, has 2
    expect(documentNameOf(new Uint8Array([10, 65, 66]))).toBeNull();
    // A length that never ends
    expect(documentNameOf(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]))).toBeNull();
    expect(documentNameOf(message('x'.repeat(600)))).toBeNull();
  });

  it('takes fragments and array buffers', () => {
    const bytes = message('diagram:a');
    const half = Math.floor(bytes.length / 2);
    const fragments = [Buffer.from(bytes.subarray(0, half)), Buffer.from(bytes.subarray(half))];
    expect(documentNameOf(messageBytes(fragments))).toBe('diagram:a');
    expect(documentNameOf(messageBytes(bytes.slice().buffer))).toBe('diagram:a');
  });
});

describe('what a socket may queue for documents it hasn’t authenticated', () => {
  it('counts every unauthenticated document together, not just the first', () => {
    const budget = new PendingBudget(1000, 20);
    expect(budget.add('diagram:a', 400)).toBe(true);
    // diagram:a authenticates: its queue is being handled, so it no longer counts
    budget.release('diagram:a');
    expect(budget.queuedBytes).toBe(0);
    // …but documents never authenticated keep adding up
    expect(budget.add('diagram:b', 600)).toBe(true);
    expect(budget.add('diagram:c', 300)).toBe(true);
    expect(budget.add('diagram:d', 200)).toBe(false);
  });

  it('caps how many documents may wait at once', () => {
    const budget = new PendingBudget(1_000_000, 3);
    expect(budget.add('a', 1)).toBe(true);
    expect(budget.add('b', 1)).toBe(true);
    expect(budget.add('c', 1)).toBe(true);
    expect(budget.add('a', 1)).toBe(true);
    expect(budget.add('d', 1)).toBe(false);
    budget.release('a');
    expect(budget.add('d', 1)).toBe(true);
  });

  it('a release for a document with nothing queued changes nothing', () => {
    const budget = new PendingBudget(10, 2);
    budget.release('never');
    expect(budget.queuedBytes).toBe(0);
  });
});
