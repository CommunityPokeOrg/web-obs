import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError } from '../src/core/commands';
import { StudioEngine } from '../src/core/studio';

function setup() {
  const e = new StudioEngine();
  const scene = e.addScene('main');
  const cam = e.addSource('webcam', 'cam');
  const title = e.addSource('text', 'title', { text: 'hi' });
  e.addToScene(scene.id, cam.id);
  e.addToScene(scene.id, title.id);
  return { e, scene, cam, title };
}

describe('applyCommand', () => {
  it('set_preview_scene', () => {
    const { e } = setup();
    const b = e.addScene('b');
    applyCommand(e, { type: 'set_preview_scene', sceneId: b.id });
    expect(e.state.previewSceneId).toBe(b.id);
  });

  it('transition defaults to fade, respects cut', () => {
    const { e } = setup();
    const b = e.addScene('b');
    e.setPreviewScene(b.id);
    applyCommand(e, { type: 'transition', mode: 'cut' });
    expect(e.state.programSceneId).toBe(b.id);
  });

  it('set_item_visible defaults to program scene', () => {
    const { e, cam } = setup();
    applyCommand(e, { type: 'set_item_visible', sourceId: cam.id, visible: false });
    expect(e.item(e.state.programSceneId!, cam.id).visible).toBe(false);
  });

  it('set_item_visible in a named scene', () => {
    const { e, cam, scene } = setup();
    const b = e.addScene('b');
    e.addToScene(b.id, cam.id);
    applyCommand(e, { type: 'set_item_visible', sourceId: cam.id, sceneId: b.id, visible: false });
    expect(e.item(b.id, cam.id).visible).toBe(false);
    expect(e.item(scene.id, cam.id).visible).toBe(true);
  });

  it('transform patches merge with existing', () => {
    const { e, cam, scene } = setup();
    e.setItemTransform(scene.id, cam.id, { x: 10, y: 20, width: 100, height: 50 });
    applyCommand(e, { type: 'set_item_transform', sourceId: cam.id, transform: { x: 42 } });
    expect(e.item(scene.id, cam.id).transform).toEqual({ x: 42, y: 20, width: 100, height: 50 });
  });

  it('volume/mute/enabled/text', () => {
    const { e, cam, title } = setup();
    applyCommand(e, { type: 'set_source_volume', sourceId: cam.id, volume: 0.3 });
    applyCommand(e, { type: 'set_source_muted', sourceId: cam.id, muted: true });
    applyCommand(e, { type: 'set_source_enabled', sourceId: cam.id, enabled: false });
    applyCommand(e, { type: 'set_text', sourceId: title.id, text: 'new' });
    expect(cam.audio.volume).toBe(0.3);
    expect(cam.audio.muted).toBe(true);
    expect(cam.enabled).toBe(false);
    expect(title.props.text).toBe('new');
  });

  it('set_text on a browser source updates url', () => {
    const { e } = setup();
    const b = e.addSource('browser', 'bb', { url: 'https://a' });
    applyCommand(e, { type: 'set_text', sourceId: b.id, text: 'https://b' });
    expect(b.props.url).toBe('https://b');
  });

  it('trigger_overlay uses injected now', () => {
    const { e } = setup();
    const ov = e.addOverlay('o', 'x', 1000);
    applyCommand(e, { type: 'trigger_overlay', overlayId: ov.id }, { now: 500 });
    expect(ov.activeUntil).toBe(1500);
  });

  it('set_output delegates to onOutput; errors when unwired', () => {
    const { e } = setup();
    const calls: [string, string][] = [];
    applyCommand(e, { type: 'set_output', output: 'record', action: 'start' }, {
      onOutput: (o, a) => calls.push([o, a]),
    });
    expect(calls).toEqual([['record', 'start']]);
    expect(() => applyCommand(e, { type: 'set_output', output: 'record', action: 'stop' })).toThrow(
      CommandError,
    );
  });

  it('bad targets raise an engine error', () => {
    const { e } = setup();
    expect(() => applyCommand(e, { type: 'set_preview_scene', sceneId: 'nope' })).toThrow(/scene/);
    expect(() => applyCommand(e, { type: 'set_source_muted', sourceId: 'nope', muted: true })).toThrow(
      /source/,
    );
  });
});
