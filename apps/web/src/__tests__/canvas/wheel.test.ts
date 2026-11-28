import { describe, it, expect } from 'vitest';
import {
  WheelInterpreter,
  classifyWheelDevice,
  type WheelInput,
} from '../../components/canvas/wheel';

function input(partial: Partial<WheelInput>): WheelInput {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    timeStamp: 0,
    ...partial,
  };
}

describe('classifyWheelDevice', () => {
  it('treats horizontal deltas as a trackpad', () => {
    expect(classifyWheelDevice(input({ deltaX: 4, deltaY: 2 }))).toBe('trackpad');
  });

  it('treats line-mode deltas (Firefox mouse wheel) as a mouse', () => {
    expect(classifyWheelDevice(input({ deltaY: 3, deltaMode: 1 }))).toBe('mouse');
  });

  it('treats large integer pixel deltas as a mouse wheel notch', () => {
    expect(classifyWheelDevice(input({ deltaY: 100 }))).toBe('mouse');
    expect(classifyWheelDevice(input({ deltaY: -120 }))).toBe('mouse');
  });

  it('spots macOS trackpads by wheelDelta = -3 × delta', () => {
    expect(classifyWheelDevice(input({ deltaY: 40, wheelDeltaY: -120 }))).toBe('trackpad');
  });

  it('spots macOS mouse wheels by 120-multiples with small deltas', () => {
    expect(classifyWheelDevice(input({ deltaY: 4.000244, wheelDeltaY: -120 }))).toBe('mouse');
  });

  it('defaults small vertical deltas to trackpad', () => {
    expect(classifyWheelDevice(input({ deltaY: 6.5 }))).toBe('trackpad');
  });
});

describe('WheelInterpreter', () => {
  it('zooms out on mouse wheel down and in on wheel up', () => {
    const w = new WheelInterpreter();
    expect(w.interpret(input({ deltaY: 100 }))).toEqual({ kind: 'zoom', factor: 0.9 });
    expect(w.interpret(input({ deltaY: -100, timeStamp: 1000 }))).toEqual({
      kind: 'zoom',
      factor: 1.1,
    });
  });

  it('pans on trackpad scroll, inverting deltas into viewport movement', () => {
    const w = new WheelInterpreter();
    expect(w.interpret(input({ deltaX: 10, deltaY: 20 }))).toEqual({ kind: 'pan', dx: -10, dy: -20 });
  });

  it('keeps a trackpad gesture sticky through large momentum deltas', () => {
    const w = new WheelInterpreter();
    w.interpret(input({ deltaX: 2, deltaY: 10, timeStamp: 0 }));
    const intent = w.interpret(input({ deltaY: 120, timeStamp: 50 }));
    expect(intent.kind).toBe('pan');
  });

  it('forgets the trackpad after the gesture ends', () => {
    const w = new WheelInterpreter();
    w.interpret(input({ deltaX: 2, deltaY: 10, timeStamp: 0 }));
    const intent = w.interpret(input({ deltaY: 100, timeStamp: 2000 }));
    expect(intent.kind).toBe('zoom');
  });

  it('zooms proportionally on pinch (ctrl+wheel), clamped', () => {
    const w = new WheelInterpreter();
    const small = w.interpret(input({ deltaY: 5, ctrlKey: true }));
    expect(small.kind).toBe('zoom');
    if (small.kind === 'zoom') expect(small.factor).toBeCloseTo(0.95);
    // Pinch steps stay smooth however they're reported
    const step = w.interpret(input({ deltaY: 3, wheelDeltaY: -120, ctrlKey: true }));
    if (step.kind === 'zoom') expect(step.factor).toBeCloseTo(Math.exp(-0.03));
  });

  it('Ctrl/⌘ + a mouse wheel notch is one 10% step, not a doubling', () => {
    const w = new WheelInterpreter();
    expect(w.interpret(input({ deltaY: 100, ctrlKey: true }))).toEqual({ kind: 'zoom', factor: 0.9 });
    expect(w.interpret(input({ deltaY: -100, metaKey: true }))).toEqual({ kind: 'zoom', factor: 1.1 });
  });

  it('shift + mouse wheel pans horizontally', () => {
    const w = new WheelInterpreter();
    expect(w.interpret(input({ deltaY: 100, shiftKey: true }))).toEqual({
      kind: 'pan',
      dx: -100,
      dy: 0,
    });
  });

  it('honours an explicit pan behaviour for mouse users who prefer it', () => {
    const w = new WheelInterpreter('pan');
    expect(w.interpret(input({ deltaY: 100 }))).toEqual({ kind: 'pan', dx: 0, dy: -100 });
  });

  it('ignores empty events', () => {
    expect(new WheelInterpreter().interpret(input({}))).toEqual({ kind: 'none' });
  });
});
