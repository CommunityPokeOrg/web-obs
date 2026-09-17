/**
 * Node-side WebSocket client wrapper around the shared wire protocol.
 * Used by tools/capture.mjs and tools/control.mjs.
 */
import WebSocket from 'ws';
import { parseMessage, encode, hello, makeId } from '../../shared/protocol.js';

/**
 * Connect + hello. Resolves on welcome, rejects on error/close/timeout.
 * @returns {Promise<{ws: WebSocket, welcome: object}>}
 */
export function connectWs({ url, role, room, token, extra = {}, timeoutMs = 8000, onMessage = null }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`connect timeout to ${url}`));
    }, timeoutMs);

    ws.on('open', () => ws.send(encode(hello(role, room, token, extra))));
    ws.on('message', (data, isBinary) => {
      // Callers may attach their own handler up front so frames delivered
      // right after the welcome (e.g. cached state) are never dropped.
      onMessage?.(data, isBinary);
      if (isBinary) return;
      const parsed = parseMessage(data.toString());
      if (!parsed.ok) return;
      const m = parsed.msg;
      if (m.kind === 'welcome') {
        clearTimeout(timer);
        resolve({ ws, welcome: m });
      } else if (m.kind === 'error') {
        clearTimeout(timer);
        reject(new Error(`${m.code}: ${m.message}`));
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      reject(new Error(`closed ${code} ${reason.toString() || ''}`.trim()));
    });
  });
}

/**
 * Controller client: hello as 'controller', tracks latest state snapshot,
 * correlates cmd→ack promises.
 */
export class ControlClient {
  constructor({ url, room, token, timeoutMs = 8000 }) {
    this.cfg = { url, room, token, timeoutMs };
    this.ws = null;
    this.snapshot = null;
    this.pending = new Map();
    this.onState = null; // cb(snapshot)
  }

  async connect() {
    const { ws } = await connectWs({
      ...this.cfg,
      role: 'controller',
      onMessage: (data, isBinary) => this.handleMessage(data, isBinary),
    });
    this.ws = ws;
    ws.on('close', () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: 'connection closed' });
      }
      this.pending.clear();
    });
    return this;
  }

  handleMessage(data, isBinary) {
    if (isBinary) return;
    const parsed = parseMessage(data.toString());
    if (!parsed.ok) return;
    const m = parsed.msg;
    if (m.kind === 'state') {
      this.snapshot = m.snapshot;
      this.onState?.(m.snapshot);
    } else if (m.kind === 'ack') {
      const p = this.pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        p.resolve({ ok: m.ok, error: m.error });
      }
    }
  }

  sendCommand(command, timeoutMs = 5000) {
    const id = makeId('c');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'ack timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.ws.send(encode({ kind: 'cmd', id, command }));
    });
  }

  /** Wait for the next state message (or first already received). */
  nextState(timeoutMs = 5000) {
    if (this.snapshot) return Promise.resolve(this.snapshot);
    return new Promise((resolve, reject) => {
      const prev = this.onState;
      const timer = setTimeout(() => {
        this.onState = prev;
        reject(new Error('timed out waiting for state'));
      }, timeoutMs);
      this.onState = (snap) => {
        clearTimeout(timer);
        this.onState = prev;
        resolve(snap);
      };
    });
  }

  close() {
    this.ws?.close();
  }
}
