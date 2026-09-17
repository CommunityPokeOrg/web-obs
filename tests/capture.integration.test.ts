import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRelayServer, type RelayServer } from '../server/server.mjs';
import { encode, hello, parseMessage } from '../shared/protocol.js';
import { runCapture, parseArgs } from '../tools/capture.mjs';
import { isJpeg } from '../tools/lib/jpeg.mjs';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await wait(15);
  }
  throw new Error('waitFor timed out');
}

let srv: RelayServer;
const TOKEN = 'tok';

beforeAll(async () => {
  srv = await createRelayServer({ port: 0, token: TOKEN, quiet: true });
});
afterAll(async () => {
  await srv.close();
});

describe('capture daemon → relay → viewer', () => {
  it('mock publisher streams jpeg frames a viewer receives', async () => {
    const viewer = new WebSocket(`${srv.url}/ws`);
    const frames: Buffer[] = [];
    let welcomed = false;
    viewer.on('message', (d, isBinary) => {
      if (isBinary) frames.push(d as Buffer);
      else {
        const p = parseMessage(d.toString());
        if (p.ok && p.msg.kind === 'welcome') welcomed = true;
      }
    });
    await new Promise((r) => viewer.on('open', r));
    viewer.send(encode(hello('viewer', 'room-cap', TOKEN, { feedId: 'mockfeed' })));
    await waitFor(() => welcomed);

    const opts = parseArgs([
      '--server', `${srv.url}/ws`,
      '--room', 'room-cap',
      '--token', TOKEN,
      '--feed', 'mockfeed',
      '--fps', '20',
      '--mock',
    ]);
    // force embedded-frame mode (no ffmpeg dependency in the test itself)
    const result = await runCapture(opts, { has: () => false, log: () => {} });
    expect(typeof result).not.toBe('number');

    await waitFor(() => frames.length >= 3);
    for (const f of frames.slice(0, 3)) expect(isJpeg(f)).toBe(true);

    (result as { ws: WebSocket }).ws.close();
    viewer.close();
    await wait(50);
  });
});
