/** Declarations for tools/control.mjs */
export interface ControlOptions {
  server: string;
  room: string;
  token: string;
  help: boolean;
  action: string;
  args: string[];
}

export interface SnapshotShape {
  canvas: { width: number; height: number; fps: number };
  scenes: { id: string; name: string; items: unknown[] }[];
  sources: { id: string; name: string; kind: string; enabled: boolean }[];
  overlays: { id: string; name: string }[];
  previewSceneId: string | null;
  programSceneId: string | null;
  transition: { progress: number } | null;
}

export function parseArgs(argv: string[]): ControlOptions;
export function findScene(snap: SnapshotShape, ref: string): SnapshotShape['scenes'][number] | undefined;
export function findSource(snap: SnapshotShape, ref: string): SnapshotShape['sources'][number] | undefined;
export function findOverlay(snap: SnapshotShape, ref: string): SnapshotShape['overlays'][number] | undefined;
export function buildCommand(action: string, args: string[], snap: SnapshotShape): { command: Record<string, unknown> };
export function renderAction(action: string, args: string[], snap: SnapshotShape): string | null;
export function runControl(argv: string[], deps?: { log?: (...a: unknown[]) => void }): Promise<number>;
