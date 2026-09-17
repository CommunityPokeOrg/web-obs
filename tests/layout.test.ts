import { describe, expect, it } from 'vitest';
import { clampTransform, coverRect, fitRect, fullFrame } from '../src/core/layout';

const canvas = { width: 1280, height: 720, fps: 30 };

describe('fitRect (contain/letterbox)', () => {
  it('fits wide source into tall dest', () => {
    const r = fitRect(1920, 1080, 1000, 1000);
    expect(r.width).toBeCloseTo(1000);
    expect(r.height).toBeCloseTo(562.5);
    expect(r.y).toBeCloseTo((1000 - 562.5) / 2);
  });
  it('fits tall source into wide dest', () => {
    const r = fitRect(720, 1280, 1280, 720);
    expect(r.height).toBeCloseTo(720);
    expect(r.width).toBeCloseTo(405);
  });
  it('degenerate inputs give empty rect', () => {
    expect(fitRect(0, 100, 100, 100).width).toBe(0);
  });
});

describe('coverRect (crop fill)', () => {
  it('overflows the smaller axis', () => {
    const r = coverRect(1920, 1080, 1000, 1000);
    expect(r.height).toBeCloseTo(1000);
    expect(r.width).toBeCloseTo(1777.78, 0);
  });
});

describe('clampTransform', () => {
  it('keeps item inside canvas', () => {
    const t = clampTransform({ x: 1200, y: 700, width: 200, height: 100 }, canvas);
    expect(t).toEqual({ x: 1080, y: 620, width: 200, height: 100 });
  });
  it('enforces minimum size and rounds', () => {
    const t = clampTransform({ x: -5, y: -5, width: 1, height: 2 }, canvas);
    expect(t.x).toBe(0);
    expect(t.width).toBe(8);
    expect(t.height).toBe(8);
  });
});

describe('fullFrame', () => {
  it('returns a letterboxed full-canvas transform', () => {
    const t = fullFrame(640, 480, canvas);
    expect(t.width).toBeCloseTo(960);
    expect(t.x).toBeCloseTo(160);
  });
});
