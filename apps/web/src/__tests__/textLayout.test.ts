import { describe, it, expect } from 'vitest';
import type { MavisElement } from '@mavisdraw/types';
import { wrapLines } from '../utils/textLayout';
import { boundTextBox, containerHeightForLabel } from '../stores/elementBindings';

/** Every character 10 units wide. */
const measure = (s: string) => s.length * 10;

describe('wrapping a label', () => {
  it('wraps word by word, keeping line breaks', () => {
    expect(wrapLines('one two three', 80, measure)).toEqual(['one two', 'three']);
    expect(wrapLines('a\nb c', 100, measure)).toEqual(['a', 'b c']);
  });

  it('leaves a word too long for the width whole on its own line', () => {
    expect(wrapLines('hi supercalifragilistic', 50, measure)).toEqual([
      'hi',
      'supercalifragilistic',
    ]);
  });
});

describe('a label’s box inside its shape', () => {
  const shape = (type: string, w = 200, h = 100) =>
    ({ type, x: 0, y: 0, width: w, height: h, angle: 0 }) as unknown as MavisElement;

  it('a rectangle’s is its box less a padding', () => {
    expect(boundTextBox(shape('rectangle'))).toEqual({ x: 10, y: 10, width: 180, height: 80 });
  });

  it('an ellipse’s and a diamond’s keep clear of the curve and the corners', () => {
    const e = boundTextBox(shape('ellipse'));
    expect(e.width).toBeCloseTo(200 * Math.SQRT1_2 - 10);
    expect(e.x + e.width / 2).toBeCloseTo(100);
    const d = boundTextBox(shape('diamond'));
    expect(d).toEqual({ x: 55, y: 30, width: 90, height: 40 });
  });

  it('a shape grows to fit a taller label, and never shrinks for a shorter one', () => {
    expect(containerHeightForLabel(shape('rectangle'), 150)).toBe(170);
    expect(containerHeightForLabel(shape('rectangle'), 20)).toBe(100);
    // (60 + 2 × 5 padding) / half the diamond
    expect(containerHeightForLabel(shape('diamond'), 60)).toBe(140);
  });
});
