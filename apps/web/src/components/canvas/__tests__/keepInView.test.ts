import { describe, it, expect } from 'vitest';
import { shiftToKeepInView } from '../keepInView';

describe('keeping the selection in view when the canvas narrows', () => {
  it('scrolls just enough to bring a shape out from under the new column', () => {
    // 1000px canvas → 776px (the inspector opens); shape at 700–800
    expect(shiftToKeepInView({ left: 700, right: 800 }, 1000, 776)).toBe(48);
  });

  it('leaves the view alone when the shape is still fully visible', () => {
    expect(shiftToKeepInView({ left: 100, right: 300 }, 1000, 776)).toBe(0);
  });

  it('never pushes the shape off the left edge (a wide selection)', () => {
    expect(shiftToKeepInView({ left: 60, right: 990 }, 1000, 776)).toBe(36);
  });

  it('ignores what was already off-screen, and widening', () => {
    expect(shiftToKeepInView({ left: 1100, right: 1200 }, 1000, 776)).toBe(0);
    expect(shiftToKeepInView({ left: 700, right: 800 }, 776, 1000)).toBe(0);
  });
});
