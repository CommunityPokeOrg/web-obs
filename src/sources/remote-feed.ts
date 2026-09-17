import { encode, hello } from '../core/protocol';

export interface RemoteFeedConfig {
  /** ws(s):// URL of the relay's multiplexer endpoint (shared /ws). */
  url: string;
  room: string;
  token: string;
  feedId: string;
}

/**
 * Receives JPEG frames for one capture-daemon feed over the relay and keeps
 * the newest decoded ImageBitmap for the compositor. Reconnects with backoff
 * until close() is called.
 */
export class RemoteFeedReceiver {
  private ws: WebSocket | null = null;
  private frame: ImageBitmap | null = null;
  private closed = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  onStatus: ((status: string) => void) | null = null;

  constructor(private cfg: RemoteFeedConfig) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.cfg.url);
    } catch {
      this.scheduleRetry('connect failed');
      return;
    }
    this.ws = ws;
    ws.binaryType = 'blob';
    ws.onopen = () => {
      this.retries = 0;
      this.onStatus?.('authenticating');
      ws.send(encode(hello('viewer', this.cfg.room, this.cfg.token, { feedId: this.cfg.feedId })));
    };
    ws.onmessage = async (ev) => {
      if (typeof ev.data === 'string') {
        // welcome/error frames
        try {
          const m = JSON.parse(ev.data);
          if (m.kind === 'welcome') this.onStatus?.('connected');
          if (m.kind === 'error') this.onStatus?.(`error: ${m.message}`);
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        const bmp = await createImageBitmap(ev.data as Blob);
        const old = this.frame;
        this.frame = bmp;
        old?.close();
      } catch {
        /* undecodable frame — drop it */
      }
    };
    ws.onclose = () => {
      if (!this.closed) {
        this.onStatus?.('disconnected');
        this.scheduleRetry('disconnected');
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry(why: string): void {
    if (this.closed) return;
    const delay = Math.min(10000, 500 * 2 ** this.retries++);
    this.onStatus?.(`${why}; retrying in ${Math.round(delay / 1000)}s`);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  getDrawable(): CanvasImageSource | null {
    return this.frame;
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.frame?.close();
    this.frame = null;
  }
}
