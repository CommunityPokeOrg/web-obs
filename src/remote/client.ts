import { Emitter } from '../core/events';
import {
  cmd as cmdMsg,
  encode,
  hello,
  makeId,
  parseMessage,
  type Command,
  type FeedInfo,
} from '../core/protocol';
import type { StudioSnapshot } from '../core/types';
import type { Transport } from './transport';

export type ClientStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export interface AckResult {
  ok: boolean;
  error?: string;
}

/**
 * Remote-controller client. Used by the remote UI (remote.html) over
 * WebSocketTransport or BroadcastChannelTransport. Holds the latest state
 * snapshot and resolves each command against its ack.
 */
export class RemoteClient {
  readonly changed = new Emitter<void>();
  status: ClientStatus = 'idle';
  statusDetail = '';
  snapshot: StudioSnapshot | null = null;
  feeds: FeedInfo[] = [];
  private pending = new Map<string, { resolve: (r: AckResult) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private transport: Transport,
    private auth: { role: 'controller'; room: string; token: string },
  ) {
    transport.onMessage((d) => this.onData(d));
    transport.onClose(() => {
      this.status = 'closed';
      this.changed.emit();
    });
  }

  async connect(): Promise<void> {
    this.status = 'connecting';
    this.changed.emit();
    if ('open' in this.transport) {
      await (this.transport as { open: Promise<void> }).open;
    }
    this.transport.send(encode(hello(this.auth.role, this.auth.room, this.auth.token)));
  }

  sendCommand(command: Command, timeoutMs = 5000): Promise<AckResult> {
    const id = makeId('c');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'ack timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.transport.send(encode(cmdMsg(command, id)));
    });
  }

  private onData(data: string): void {
    const parsed = parseMessage(data);
    if (!parsed.ok) return;
    const msg = parsed.msg;
    switch (msg.kind) {
      case 'welcome':
        this.status = 'connected';
        this.statusDetail = '';
        this.changed.emit();
        return;
      case 'error':
        this.status = 'error';
        this.statusDetail = msg.message;
        this.changed.emit();
        return;
      case 'state':
        this.snapshot = msg.snapshot as StudioSnapshot;
        this.changed.emit();
        return;
      case 'feeds':
        this.feeds = msg.feeds;
        this.changed.emit();
        return;
      case 'ack': {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve({ ok: msg.ok, error: msg.error });
        }
        return;
      }
      default:
        return;
    }
  }

  close(): void {
    this.transport.close();
  }
}
