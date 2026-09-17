import type { StudioEngine } from '../core/studio';
import type { AudioMixer } from '../sources/mixer';
import type { MediaSourceManager } from '../sources/manager';
import type { RemoteHost } from '../remote/host';
import type { OutputManager } from '../streaming/output';

export interface StudioEnv {
  controlUrl: string | null;
  room: string;
  token: string;
  bridgeUrl: string | null;
  whipUrl: string | null;
}

/** Everything UI components need; constructed once in main.tsx. */
export interface AppContext {
  engine: StudioEngine;
  mixer: AudioMixer;
  sources: MediaSourceManager;
  host: RemoteHost;
  outputs: OutputManager;
  env: StudioEnv;
  /** Canvas element the compositor draws into (mounted by PreviewCanvas). */
  canvas: HTMLCanvasElement;
  /** Build the program output stream for output adapters. */
  programStream: () => MediaStream;
}
