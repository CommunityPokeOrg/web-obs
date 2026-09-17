import { makeId } from '../core/protocol';

/** String-frame transport abstraction used by both the studio host and
 * remote controllers. Implementations: WebSocket (cross-device via relay)
 * and BroadcastChannel (same-browser tabs — the zero-infrastructure path). */
export interface Transport {
  readonly name: string;
  send(data: string): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export class WebSocketTransport implements Transport {
  readonly name = 'websocket';
  private ws: WebSocket;
  private msgCb: ((data: string) => void) | null = null;
  private closeCb: (() => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.msgCb?.(ev.data);
    };
    this.ws.onclose = () => this.closeCb?.();
  }

  get open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('ws connect failed'));
    });
  }

  send(data: string): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  onMessage(cb: (data: string) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * BroadcastChannel transport. Same-origin, same-browser only — handy for a
 * remote running in a second tab/window on the same machine with no server.
 * Messages are framed {src, payload} so senders can drop their own echoes
 * (BroadcastChannel delivers to every other context on the channel).
 */
export class BroadcastChannelTransport implements Transport {
  readonly name = 'broadcastchannel';
  readonly id = makeId('bc');
  private bc: BroadcastChannel;
  private msgCb: ((data: string) => void) | null = null;
  private closeCb: (() => void) | null = null;

  constructor(channel: string) {
    this.bc = new BroadcastChannel(channel);
    this.bc.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { src?: string; payload?: unknown };
      if (m && typeof m === 'object' && m.src !== this.id && typeof m.payload === 'string') {
        this.msgCb?.(m.payload);
      }
    };
  }

  static channelName(room: string): string {
    return `web-obs:${room}`;
  }

  send(data: string): void {
    this.bc.postMessage({ src: this.id, payload: data });
  }

  onMessage(cb: (data: string) => void): void {
    this.msgCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  close(): void {
    this.bc.close();
    this.closeCb?.();
  }
}
