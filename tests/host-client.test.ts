import { describe, expect, it, vi } from 'vitest';
import { RemoteClient } from '../src/remote/client';
import { RemoteHost } from '../src/remote/host';
import { BroadcastChannelTransport } from '../src/remote/transport';
import { StudioEngine } from '../src/core/studio';
import { makeId } from '../src/core/protocol';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await wait(20);
  }
  throw new Error('waitFor timed out');
}

function chanPair() {
  const name = BroadcastChannelTransport.channelName(`t-${makeId('r')}`);
  return { a: () => new BroadcastChannelTransport(name), b: () => new BroadcastChannelTransport(name) };
}

describe('RemoteHost + RemoteClient over BroadcastChannel', () => {
  it('hello → welcome → snapshot → command → ack → state broadcast', async () => {
    const engine = new StudioEngine();
    const scene = engine.addScene('s');
    const src = engine.addSource('text', 't', { text: 'x' });
    engine.addToScene(scene.id, src.id);
    const host = new RemoteHost(engine, { token: 'tok', stateThrottleMs: 10 });
    const pair = chanPair();
    host.attachPeer(pair.a());

    const client = new RemoteClient(
      pair.b(),
      { role: 'controller', room: 'r', token: 'tok' },
    );
    await client.connect();
    await waitFor(() => client.status === 'connected' && !!client.snapshot);
    expect(client.snapshot!.scenes).toHaveLength(1);

    const r = await client.sendCommand({ type: 'set_source_muted', sourceId: src.id, muted: true });
    expect(r.ok).toBe(true);
    await waitFor(() => client.snapshot!.sources[0].audio.muted === true);

    host.close();
    client.close();
  });

  it('rejects a bad token', async () => {
    const engine = new StudioEngine();
    engine.addScene('s');
    const host = new RemoteHost(engine, { token: 'right', stateThrottleMs: 10 });
    const pair = chanPair();
    host.attachPeer(pair.a());

    const client = new RemoteClient(
      pair.b(),
      { role: 'controller', room: 'r', token: 'wrong' },
    );
    await client.connect();
    await waitFor(() => client.status === 'error');
    expect(client.statusDetail).toContain('token');
    host.close();
    client.close();
  });

  it('acks command errors (not_found) without killing the channel', async () => {
    const engine = new StudioEngine();
    engine.addScene('s');
    const host = new RemoteHost(engine, { token: 't', stateThrottleMs: 10 });
    const pair = chanPair();
    host.attachPeer(pair.a());
    const client = new RemoteClient(pair.b(), {
      role: 'controller', room: 'r', token: 't',
    });
    await client.connect();
    await waitFor(() => client.status === 'connected');
    const r = await client.sendCommand({ type: 'set_source_muted', sourceId: 'ghost', muted: true });
    expect(r.ok).toBe(false);
    const ok = await client.sendCommand({ type: 'set_preview_scene', sceneId: engine.state.scenes[0].id });
    expect(ok.ok).toBe(true);
    host.close();
    client.close();
  });

  it('set_output routes to onOutput delegate', async () => {
    const engine = new StudioEngine();
    engine.addScene('s');
    const onOutput = vi.fn();
    const host = new RemoteHost(engine, { token: 't', onOutput, stateThrottleMs: 10 });
    const pair = chanPair();
    host.attachPeer(pair.a());
    const client = new RemoteClient(pair.b(), {
      role: 'controller', room: 'r', token: 't',
    });
    await client.connect();
    await waitFor(() => client.status === 'connected');
    const r = await client.sendCommand({ type: 'set_output', output: 'record', action: 'start' });
    expect(r.ok).toBe(true);
    expect(onOutput).toHaveBeenCalledWith('record', 'start');
    host.close();
    client.close();
  });
});
