import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRelayServer, type RelayServer } from '../server/server.mjs';
import { encode, hello } from '../shared/protocol.js';
import { RemoteHost } from '../src/remote/host';
import type { Transport } from '../src/remote/transport';
import { StudioEngine } from '../src/core/studio';
import { ControlClient } from '../tools/lib/node-client.mjs';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await wait(15);
  }
  throw new Error('waitFor timed out');
}

/** Minimal Transport impl over the `ws` package for Node-side tests. */
class NodeWsTransport implements Transport {
  readonly name = 'node-ws';
  private ws: WebSocket;
  private msgCb: ((d: string) => void) | null = null;
  private closeCb: (() => void) | null = null;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data, isBinary) => {
      if (!isBinary) this.msgCb?.(data.toString());
    });
    this.ws.on('close', () => this.closeCb?.());
  }
  get open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.on('open', () => res());
      this.ws.on('error', rej);
    });
  }
  send(data: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }
  onMessage(cb: (d: string) => void): void {
    this.msgCb = cb;
  }
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }
  close(): void {
    this.ws.close();
  }
}

let srv: RelayServer;
const TOKEN = 'test-token';
const ROOM = 'it-room';

beforeAll(async () => {
  srv = await createRelayServer({ port: 0, token: TOKEN, quiet: true });
});

afterAll(async () => {
  await srv.close();
});

describe('relay server', () => {
  it('health endpoint responds', async () => {
    const res = await fetch(`http://localhost:${srv.port}/health`);
    expect((await res.json()).ok).toBe(true);
  });

  it('rejects bad token at handshake', async () => {
    const ws = new WebSocket(`${srv.url}/ws`);
    const got: string[] = [];
    ws.on('message', (d) => got.push(d.toString()));
    await new Promise((r) => ws.on('open', r));
    ws.send(encode(hello('controller', ROOM, 'wrong-token')));
    await waitFor(() => got.some((g) => g.includes('"auth"')));
    ws.close();
  });

  it('end-to-end: studio uplink + controller command + ack + state relay', async () => {
    const engine = new StudioEngine();
    const scene = engine.addScene('live');
    const src = engine.addSource('webcam', 'cam');
    engine.addToScene(scene.id, src.id);

    const host = new RemoteHost(engine, { token: TOKEN, stateThrottleMs: 10 });
    const uplink = new NodeWsTransport(`${srv.url}/ws`);
    await host.attachServer(uplink, ROOM);
    await waitFor(() => host.uplinkStatus === 'connected');

    const client = await new ControlClient({ url: `${srv.url}/ws`, room: ROOM, token: TOKEN }).connect();
    const snap = (await client.nextState()) as { scenes: { id: string }[] };
    expect(snap.scenes[0].id).toBe(scene.id);

    const r = await client.sendCommand({ type: 'set_source_volume', sourceId: src.id, volume: 0.25 });
    expect(r.ok).toBe(true);
    expect(engine.source(src.id).audio.volume).toBe(0.25);

    // state broadcast relayed through the server back to the controller —
    // drop the cached snapshot so nextState() waits for a fresh one
    client.snapshot = null;
    const snap2 = (await client.nextState()) as { sources: { audio: { volume: number } }[] };
    expect(snap2.sources[0].audio.volume).toBe(0.25);

    client.close();
    host.close();
  });

  it('capture feed relays binary frames to viewers; feeds announced', async () => {
    // studio uplink to receive 'feeds' announcements
    const engine = new StudioEngine();
    engine.addScene('s');
    const host = new RemoteHost(engine, { token: TOKEN, stateThrottleMs: 10 });
    const feedsSeen: string[][] = [];
    host.feeds.subscribe((f) => feedsSeen.push(f.map((x) => x.id)));
    await host.attachServer(new NodeWsTransport(`${srv.url}/ws`), ROOM);
    await waitFor(() => host.uplinkStatus === 'connected');

    // viewer subscribes to the feed
    const viewer = new WebSocket(`${srv.url}/ws`);
    const binaries: Buffer[] = [];
    viewer.on('message', (d, isBinary) => {
      if (isBinary) binaries.push(d as Buffer);
    });
    await new Promise((r) => viewer.on('open', r));
    viewer.send(encode(hello('viewer', ROOM, TOKEN, { feedId: 'feed-1' })));

    // capture publisher
    const cap = new WebSocket(`${srv.url}/ws`);
    await new Promise((r) => cap.on('open', r));
    cap.send(encode(hello('capture', ROOM, TOKEN, { feedId: 'feed-1', label: 'Test Feed' })));

    await waitFor(() => feedsSeen.flat().includes('feed-1'));
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal SOI/EOI
    cap.send(jpeg, { binary: true });
    await waitFor(() => binaries.length > 0);
    expect(binaries[0].equals(jpeg)).toBe(true);

    cap.close();
    viewer.close();
    host.close();
  });
});
