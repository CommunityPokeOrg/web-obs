import { describe, expect, it, vi } from 'vitest';
import { EngineError, StudioEngine } from '../src/core/studio';

function makeEngine() {
  const e = new StudioEngine();
  const s1 = e.addScene('A');
  const s2 = e.addScene('B');
  return { e, s1, s2 };
}

describe('scene lifecycle', () => {
  it('first scene becomes program+preview', () => {
    const e = new StudioEngine();
    const s = e.addScene('first');
    expect(e.state.programSceneId).toBe(s.id);
    expect(e.state.previewSceneId).toBe(s.id);
  });

  it('setPreviewScene validates target', () => {
    const { e } = makeEngine();
    expect(() => e.setPreviewScene('nope')).toThrow(EngineError);
  });

  it('cannot remove the last scene; removal reassigns program', () => {
    const e = new StudioEngine();
    const only = e.addScene('only');
    expect(() => e.removeScene(only.id)).toThrow('last scene');
    const b = e.addScene('b');
    e.setPreviewScene(b.id);
    e.transition('cut');
    expect(e.state.programSceneId).toBe(b.id);
    e.removeScene(b.id);
    expect(e.state.programSceneId).toBe(only.id);
  });
});

describe('sources and items', () => {
  it('add/place/duplicate/remove', () => {
    const { e, s1 } = makeEngine();
    const src = e.addSource('color', 'bg', { fill: '#000' });
    e.addToScene(s1.id, src.id);
    expect(() => e.addToScene(s1.id, src.id)).toThrow('already in scene');
    e.removeFromScene(s1.id, src.id);
    expect(e.scene(s1.id).items).toHaveLength(0);
  });

  it('removeSource strips placements everywhere', () => {
    const { e, s1, s2 } = makeEngine();
    const src = e.addSource('text', 't', { text: 'hi' });
    e.addToScene(s1.id, src.id);
    e.addToScene(s2.id, src.id);
    e.removeSource(src.id);
    expect(e.scene(s1.id).items).toHaveLength(0);
    expect(e.scene(s2.id).items).toHaveLength(0);
    expect(e.state.sources).toHaveLength(0);
  });

  it('z-order: moveItem raises/lowers', () => {
    const { e, s1 } = makeEngine();
    const a = e.addSource('color', 'a');
    const b = e.addSource('color', 'b');
    e.addToScene(s1.id, a.id);
    e.addToScene(s1.id, b.id);
    e.moveItem(s1.id, a.id, 1);
    expect(e.scene(s1.id).items.map((i) => i.sourceId)).toEqual([b.id, a.id]);
  });

  it('setItemTransform clamps to canvas', () => {
    const { e, s1 } = makeEngine();
    const src = e.addSource('color', 'c');
    e.addToScene(s1.id, src.id);
    e.setItemTransform(s1.id, src.id, { x: 9999, y: -5, width: 100, height: 50 });
    const t = e.item(s1.id, src.id).transform;
    expect(t.x).toBe(1280 - 100);
    expect(t.y).toBe(0);
  });
});

describe('transitions', () => {
  it('cut switches program instantly', () => {
    const { e, s2 } = makeEngine();
    e.setPreviewScene(s2.id);
    e.transition('cut');
    expect(e.state.programSceneId).toBe(s2.id);
    expect(e.state.transition).toBeNull();
  });

  it('fade progresses via tick and lands on preview', () => {
    const { e, s1, s2 } = makeEngine();
    e.setPreviewScene(s2.id);
    e.transition('fade', 1000);
    const t = e.state.transition!;
    expect(t.fromSceneId).toBe(s1.id);
    e.tick(1250);
    expect(e.state.transition!.progress).toBeCloseTo(0.5);
    e.tick(2000);
    expect(e.state.transition).toBeNull();
    expect(e.state.programSceneId).toBe(s2.id);
  });

  it('transition to same scene is a no-op', () => {
    const { e, s1 } = makeEngine();
    e.setPreviewScene(s1.id);
    e.transition('fade');
    expect(e.state.transition).toBeNull();
  });
});

describe('overlays & audio state', () => {
  it('trigger → active → expires on tick', () => {
    const e = new StudioEngine();
    e.addScene('s');
    const ov = e.addOverlay('o', 'text', 1000);
    e.triggerOverlay(ov.id, 1000);
    expect(ov.activeUntil).toBe(2000);
    e.tick(2500);
    expect(ov.activeUntil).toBeNull();
  });

  it('volume is validated', () => {
    const { e } = makeEngine();
    const s = e.addSource('webcam', 'cam');
    e.setSourceVolume(s.id, 0.5);
    expect(s.audio.volume).toBe(0.5);
    expect(() => e.setSourceVolume(s.id, 1.5)).toThrow('0..1');
  });
});

describe('events & snapshot', () => {
  it('emits on mutation and snapshot is a copy', () => {
    const { e } = makeEngine();
    const spy = vi.fn();
    e.changed.subscribe(spy);
    e.addSource('text', 'x');
    expect(spy).toHaveBeenCalled();
    const snap = e.snapshot();
    snap.sources[0].name = 'mutated';
    expect(e.state.sources[0].name).toBe('x');
  });
});
