import { Emitter } from '../core/events';
import { applyCommand } from '../core/commands';
import {
  ack,
  encode,
  err,
  hello,
  parseMessage,
  state as stateMsg,
  type FeedInfo,
} from '../core/protocol';
import type { StudioEngine } from '../core/studio';
import type { Transport } from './transport';

export interface HostOptions {
  /** Shared secret. Uplink: sent in the studio's own hello. Peers: required
   * from each controller's hello. */
  token: string;
  onOutput?: (output: string, action: 'start' | 'stop') => void;
  stateThrottleMs?: number;
}

interface PeerCtx {
  transport: Transport;
  authed: boolean;
}

export type UplinkStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Studio-side remote-control host with two attachment modes:
 *
 *  - `attachServer(t, room)` — an uplink to the relay server. The studio
 *    authenticates itself; the server vets controllers and forwards cmds
 *    (with `cid`) plus 'feeds' announcements. State snapshots flow up.
 *  - `attachPeer(t)` — a BroadcastChannel-style peer transport where this
 *    host authenticates each controller's hello directly (zero-server path).
 *
 * Commands in both modes go through the same applyCommand path as the UI.
 */
export class RemoteHost {
  readonly feeds = new Emitter<FeedInfo[]>();
  readonly uplinkChanged = new Emitter<UplinkStatus>();
  uplinkStatus: UplinkStatus = 'disconnected';
  uplinkError = '';

  private peers = new Set<PeerCtx>();
  private server: Transport | null = null;
  private serverAuthed = false;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private engine: StudioEngine,
    private opts: HostOptions,
  ) {
    engine.changed.subscribe(() => this.scheduleStateBroadcast());
  }

  async attachServer(t: Transport, room: string): Promise<void> {
    this.server = t;
    this.setUplink('connecting');
    t.onMessage((data) => this.onServerData(data));
    t.onClose(() => {
      this.serverAuthed = false;
      this.setUplink('disconnected');
    });
    if ('open' in t) {
      try {
        await (t as { open: Promise<void> }).open;
      } catch (e) {
        this.setUplink('error', e instanceof Error ? e.message : 'connect failed');
        return;
      }
    }
    t.send(encode(hello('studio', room, this.opts.token)));
  }

  attachPeer(t: Transport): void {
    const ctx: PeerCtx = { transport: t, authed: false };
    t.onMessage((data) => this.onPeerData(ctx, data));
    t.onClose(() => this.peers.delete(ctx));
  }

  private setUplink(s: UplinkStatus, error = ''): void {
    this.uplinkStatus = s;
    this.uplinkError = error;
    this.uplinkChanged.emit(s);
  }

  private onServerData(data: string): void {
    const parsed = parseMessage(data);
    if (!parsed.ok) return;
    const msg = parsed.msg;
    switch (msg.kind) {
      case 'welcome':
        this.serverAuthed = true;
        this.setUplink('connected');
        this.broadcastState();
        return;
      case 'error':
        this.setUplink('error', msg.message);
        return;
      case 'cmd': {
        try {
          applyCommand(this.engine, msg.command, { onOutput: this.opts.onOutput });
          this.server?.send(encode(ack(msg.id, true, undefined, msg.cid)));
        } catch (e) {
          this.server?.send(
            encode(ack(msg.id, false, e instanceof Error ? e.message : String(e), msg.cid)),
          );
        }
        return;
      }
      case 'feeds':
        this.feeds.emit(msg.feeds);
        return;
      default:
        return;
    }
  }

  private onPeerData(ctx: PeerCtx, data: string): void {
    const parsed = parseMessage(data);
    if (!parsed.ok) return;
    const msg = parsed.msg;
    switch (msg.kind) {
      case 'hello':
        if (msg.role !== 'controller' || msg.token !== this.opts.token) {
          ctx.transport.send(encode(err('auth', 'bad token')));
          return;
        }
        ctx.authed = true;
        this.peers.add(ctx);
        ctx.transport.send(encode({ kind: 'welcome', role: 'controller', room: msg.room }));
        ctx.transport.send(encode(stateMsg(this.engine.snapshot())));
        return;
      case 'cmd':
        if (!ctx.authed) {
          ctx.transport.send(encode(err('auth', 'hello first')));
          return;
        }
        try {
          applyCommand(this.engine, msg.command, { onOutput: this.opts.onOutput });
          ctx.transport.send(encode(ack(msg.id, true, undefined, msg.cid)));
        } catch (e) {
          ctx.transport.send(
            encode(ack(msg.id, false, e instanceof Error ? e.message : String(e), msg.cid)),
          );
        }
        return;
      default:
        return;
    }
  }

  private scheduleStateBroadcast(): void {
    if (this.throttleTimer) return;
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      this.broadcastState();
    }, this.opts.stateThrottleMs ?? 150);
  }

  private broadcastState(): void {
    const data = encode(stateMsg(this.engine.snapshot()));
    if (this.server && this.serverAuthed) this.server.send(data);
    for (const p of this.peers) if (p.authed) p.transport.send(data);
  }

  close(): void {
    this.server?.close();
    this.server = null;
    for (const p of this.peers) p.transport.close();
    this.peers.clear();
  }
}
