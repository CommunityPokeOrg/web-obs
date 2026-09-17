/** Type declarations for server/server.mjs */

export interface RelayServerOptions {
  port?: number;
  token?: string;
  rtmpUrl?: string;
  recordDir?: string;
  staticDir?: string;
  quiet?: boolean;
}

export interface RelayServer {
  port: number;
  token: string;
  generatedToken: boolean;
  url: string;
  close(): Promise<void>;
}

export function createRelayServer(opts: RelayServerOptions): Promise<RelayServer>;
