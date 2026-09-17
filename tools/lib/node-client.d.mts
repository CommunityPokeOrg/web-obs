/** Declarations for tools/lib/node-client.mjs */
import type WebSocket from 'ws';

export interface ConnectOptions {
  url: string;
  role: 'studio' | 'controller' | 'capture' | 'viewer';
  room: string;
  token: string;
  extra?: Record<string, unknown>;
  timeoutMs?: number;
  /** Handler attached before the hello reply arrives — prevents dropping
   * frames the server sends immediately after welcome (e.g. cached state). */
  onMessage?: ((data: Buffer, isBinary: boolean) => void) | null;
}

export function connectWs(opts: ConnectOptions): Promise<{ ws: WebSocket; welcome: unknown }>;

export interface AckResult {
  ok: boolean;
  error?: string;
}

export class ControlClient {
  constructor(cfg: { url: string; room: string; token: string; timeoutMs?: number });
  ws: WebSocket | null;
  snapshot: unknown | null;
  onState: ((snapshot: unknown) => void) | null;
  connect(): Promise<this>;
  sendCommand(command: Record<string, unknown>, timeoutMs?: number): Promise<AckResult>;
  nextState(timeoutMs?: number): Promise<unknown>;
  close(): void;
}
