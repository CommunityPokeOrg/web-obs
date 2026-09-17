import { encode, hello } from '../core/protocol';
import { BaseOutput } from './output';
import { pickMimeType } from './recorder';

export interface BridgeConfig {
  /** ws(s):// URL of the relay's /bridge endpoint */
  url: string;
  room: string;
  token: string;
}

/**
 * Program-out over WebSocket to the relay server's /bridge endpoint.
 * The server records the WebM and, when RTMP_URL is configured and ffmpeg
 * is installed, republishes to an RTMP target. Streams MediaRecorder
 * chunks as binary frames.
 */
export class BridgeOutput extends BaseOutput {
  readonly id = 'bridge';
  readonly label = 'Bridge → server record/RTMP';
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;

  constructor(private cfg: BridgeConfig | null) {
    super();
  }

  unavailableReason(): string | null {
    if (!this.cfg?.url) return 'no VITE_BRIDGE_WS_URL configured';
    if (typeof MediaRecorder === 'undefined') return 'MediaRecorder unsupported';
    if (!pickMimeType((t) => MediaRecorder.isTypeSupported(t))) return 'no supported mime type';
    return null;
  }

  async start(getStream: () => MediaStream): Promise<void> {
    if (this.recorder) return;
    const reason = this.unavailableReason();
    if (reason) throw new Error(reason);
    this.setStatus('starting');

    const ws = new WebSocket(this.cfg!.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('bridge connect timeout'));
      }, 8000);
      const cleanup = () => clearTimeout(timer);
      ws.onopen = () => {
        ws.send(encode(hello('studio', this.cfg!.room, this.cfg!.token)));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const m = JSON.parse(ev.data);
          if (m.kind === 'welcome') {
            cleanup();
            resolve();
          } else if (m.kind === 'error') {
            cleanup();
            reject(new Error(`bridge: ${m.message}`));
          }
        } catch {
          /* binary or stray */
        }
      };
      ws.onerror = () => {
        cleanup();
        reject(new Error('bridge socket error'));
      };
      ws.onclose = () => {
        cleanup();
        reject(new Error('bridge closed before handshake'));
      };
    });

    const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t))!;
    const rec = new MediaRecorder(getStream(), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    this.recorder = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size && this.ws?.readyState === WebSocket.OPEN) {
        e.data.arrayBuffer().then((buf) => this.ws?.send(buf));
      }
    };
    rec.onerror = () => {
      this.setStatus('error', 'recorder error');
      void this.stop();
    };
    rec.start(250);
    this.setStatus('active');
  }

  async stop(): Promise<void> {
    if (!this.recorder && !this.ws) return;
    this.setStatus('stopping');
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
    // Give the recorder a beat to flush its last chunk before closing.
    await new Promise((r) => setTimeout(r, 300));
    this.ws?.close();
    this.ws = null;
    this.setStatus('idle');
  }
}
