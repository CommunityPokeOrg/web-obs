import { describe, expect, it } from 'vitest';
import {
  ack,
  cmd,
  encode,
  err,
  hello,
  isCommand,
  parseMessage,
  state,
} from '../shared/protocol.js';

describe('parseMessage', () => {
  it('accepts a valid hello per role', () => {
    for (const role of ['studio', 'controller', 'capture', 'viewer'] as const) {
      const m = hello(role, 'r', 'tok', role === 'capture' || role === 'viewer' ? { feedId: 'f' } : {});
      const p = parseMessage(encode(m));
      expect(p.ok).toBe(true);
    }
  });

  it('rejects bad version/role/missing fields', () => {
    expect(parseMessage('{"kind":"hello","v":99,"role":"studio","room":"r","token":"t"}').ok).toBe(false);
    expect(parseMessage('{"kind":"hello","v":1,"role":"nope","room":"r","token":"t"}').ok).toBe(false);
    expect(parseMessage('{"kind":"hello","v":1,"role":"capture","room":"r","token":"t"}').ok).toBe(false); // no feedId
    expect(parseMessage('not json').ok).toBe(false);
    expect(parseMessage('{"kind":"zzz"}').ok).toBe(false);
  });

  it('round-trips cmd/ack/state/error', () => {
    for (const m of [
      cmd({ type: 'set_preview_scene', sceneId: 's1' }, 'id1', 'cid9'),
      ack('id1', true),
      ack('id1', false, 'nope'),
      state({ scenes: [] }),
      err('code', 'message'),
      { kind: 'feeds', feeds: [{ id: 'f', label: 'F' }] },
      { kind: 'welcome', role: 'controller', room: 'r' },
    ]) {
      const p = parseMessage(encode(m as never));
      expect(p.ok, JSON.stringify(m)).toBe(true);
    }
  });
});

describe('isCommand', () => {
  it('accepts all valid commands', () => {
    const valid = [
      { type: 'set_preview_scene', sceneId: 's' },
      { type: 'transition' },
      { type: 'transition', mode: 'cut' },
      { type: 'set_item_visible', sourceId: 's', visible: true },
      { type: 'set_item_transform', sourceId: 's', transform: { x: 1 } },
      { type: 'set_source_enabled', sourceId: 's', enabled: false },
      { type: 'set_source_volume', sourceId: 's', volume: 0.5 },
      { type: 'set_source_muted', sourceId: 's', muted: true },
      { type: 'set_text', sourceId: 's', text: 'x' },
      { type: 'trigger_overlay', overlayId: 'o' },
      { type: 'set_output', output: 'record', action: 'start' },
    ];
    for (const c of valid) expect(isCommand(c), JSON.stringify(c)).toBe(true);
  });

  it('rejects malformed commands', () => {
    const bad = [
      null, {}, { type: 'nope' },
      { type: 'set_preview_scene' },
      { type: 'set_source_volume', sourceId: 's', volume: 2 },
      { type: 'transition', mode: 'zip' },
      { type: 'set_output', output: 'o', action: 'poke' },
      { type: 'set_item_visible', sourceId: 's', visible: 'yes' },
    ];
    for (const c of bad) expect(isCommand(c), JSON.stringify(c)).toBe(false);
  });
});
