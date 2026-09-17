import { describe, expect, it } from 'vitest';
import { Compositor, type Draw2D } from '../src/compositor/compositor';
import { StudioEngine } from '../src/core/studio';

class StubCtx implements Draw2D {
  canvas = { width: 1280, height: 720 };
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  globalAlpha = 1;
  calls: string[] = [];
  fillRect(x: number, y: number, w: number, h: number) {
    this.calls.push(`fillRect(${x},${y},${w},${h},${String(this.fillStyle)},a=${this.globalAlpha})`);
  }
  strokeRect() {}
  drawImage(_img: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) {
    this.calls.push(`drawImage(${dx},${dy},${dw},${dh},a=${this.globalAlpha})`);
  }
  fillText(t: string, x: number, y: number) {
    this.calls.push(`fillText("${t}",${Math.round(x)},${Math.round(y)})`);
  }
  measureText(t: string) {
    return { width: t.length * 10 };
  }
  save() {}
  restore() {}
}

const BITMAP = {} as CanvasImageSource;

function setup() {
  const e = new StudioEngine();
  const scene = e.addScene('main');
  return { e, scene };
}

describe('Compositor', () => {
  it('draws scene items back-to-front, honoring visible/enabled', () => {
    const { e, scene } = setup();
    const bg = e.addSource('color', 'bg', { fill: '#111' });
    const vid = e.addSource('webcam', 'cam');
    e.addToScene(scene.id, bg.id, { x: 0, y: 0, width: 1280, height: 720 });
    e.addToScene(scene.id, vid.id, { x: 10, y: 10, width: 100, height: 100 });
    e.setItemVisible(scene.id, vid.id, false);

    const ctx = new StubCtx();
    const comp = new Compositor(e, { getDrawable: () => BITMAP }, ctx);
    comp.drawFrame(0);
    const draws = ctx.calls.filter((c) => c.startsWith('drawImage'));
    expect(draws).toHaveLength(0); // hidden item not drawn

    e.setItemVisible(scene.id, vid.id, true);
    ctx.calls = [];
    comp.drawFrame(0);
    expect(ctx.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(1);

    e.setSourceEnabled(vid.id, false);
    ctx.calls = [];
    comp.drawFrame(0);
    expect(ctx.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(0);
  });

  it('missing drawable renders a placeholder panel', () => {
    const { e, scene } = setup();
    const cam = e.addSource('webcam', 'cam');
    e.addToScene(scene.id, cam.id, { x: 0, y: 0, width: 300, height: 200 });
    const ctx = new StubCtx();
    new Compositor(e, { getDrawable: () => null }, ctx).drawFrame(0);
    expect(ctx.calls.some((c) => c.includes('#16181d'))).toBe(true);
    expect(ctx.calls.some((c) => c.includes('no signal'))).toBe(true);
  });

  it('fade transition draws to-scene with progress alpha', () => {
    const { e, scene } = setup();
    const a = e.addSource('color', 'a', { fill: '#111' });
    e.addToScene(scene.id, a.id, { x: 0, y: 0, width: 1280, height: 720 });
    const b = e.addScene('next');
    const c = e.addSource('color', 'c', { fill: '#f0f' });
    e.addToScene(b.id, c.id, { x: 0, y: 0, width: 1280, height: 720 });

    e.setPreviewScene(b.id);
    e.transition('fade', 0);
    e.tick(250); // 50%

    const ctx = new StubCtx();
    new Compositor(e, { getDrawable: () => null }, ctx).drawFrame(250);
    const halfAlpha = ctx.calls.filter((c) => c.includes('a=0.5'));
    expect(halfAlpha.length).toBeGreaterThan(0);
  });

  it('active overlays draw a banner and expire', () => {
    const { e } = setup();
    const ov = e.addOverlay('o', 'BIG NEWS', 1000);
    e.triggerOverlay(ov.id, 0);
    const ctx = new StubCtx();
    new Compositor(e, { getDrawable: () => null }, ctx).drawFrame(500);
    expect(ctx.calls.some((c) => c.includes('BIG NEWS'))).toBe(true);

    e.tick(1500); // expired
    ctx.calls = [];
    new Compositor(e, { getDrawable: () => null }, ctx).drawFrame(1500);
    expect(ctx.calls.some((c) => c.includes('BIG NEWS'))).toBe(false);
  });

  it('text source draws text with configured color', () => {
    const { e, scene } = setup();
    const t = e.addSource('text', 't', { text: 'HELLO', color: '#ff0000' });
    e.addToScene(scene.id, t.id, { x: 0, y: 0, width: 400, height: 100 });
    const ctx = new StubCtx();
    new Compositor(e, { getDrawable: () => null }, ctx).drawFrame(0);
    expect(ctx.calls.some((c) => c.includes('HELLO'))).toBe(true);
  });
});
