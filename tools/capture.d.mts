/** Declarations for tools/capture.mjs */
export interface CaptureOptions {
  server: string;
  room: string;
  token: string;
  feed: string;
  fps: number;
  quality: number;
  backend: string | null;
  window: string | null;
  display: string | null;
  device: number;
  list: boolean;
  dryRun: boolean;
  mock: boolean;
  help: boolean;
}

export interface BackendEnv {
  platform: string;
  sessionType?: string;
  display?: string;
  device?: number;
  window?: string | null;
  force?: string | null;
  has(bin: string): boolean;
}

export interface Backend {
  id: string;
  available: boolean;
  reason: string | null;
  describe(): string;
}

export declare const MOCK_FRAME: Buffer;
export declare const USAGE: string;
export function parseArgs(argv: string[]): CaptureOptions;
export function hasBin(name: string, which?: (n: string) => boolean): boolean;
export function selectBackend(env: BackendEnv): Backend;
export function ffmpegArgs(backendId: string, opts: CaptureOptions, display?: string): string[];
export function runCapture(
  opts: CaptureOptions,
  deps?: {
    log?: (...a: unknown[]) => void;
    platform?: string;
    sessionType?: string;
    display?: string;
    has?: (b: string) => boolean;
  },
): Promise<{ ws: unknown; frames(): number } | number>;
