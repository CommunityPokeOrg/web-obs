export type SourceKind =
  | 'webcam'
  | 'screen'
  | 'media'
  | 'browser'
  | 'remote'
  | 'text'
  | 'color'
  | 'image';

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AudioState {
  /** 0..1 linear gain */
  volume: number;
  muted: boolean;
}

export interface SourceProps {
  /** text source */
  text?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
  /** color source */
  fill?: string;
  /** browser source */
  url?: string;
  /** media/image source */
  fileName?: string;
  /** remote source: feed id published by a capture daemon */
  feedId?: string;
  /** webcam/screen: track label captured at attach time */
  deviceLabel?: string;
}

export interface SourceDef {
  id: string;
  kind: SourceKind;
  name: string;
  /** Master enable for the feed itself. A disabled source produces no
   * video/audio anywhere it is placed (remote "kill feed" switch). */
  enabled: boolean;
  audio: AudioState;
  props: SourceProps;
}

export interface SceneItem {
  id: string;
  sourceId: string;
  transform: Transform;
  visible: boolean;
}

export interface Scene {
  id: string;
  name: string;
  /** Back-to-front order: first item is drawn first (bottom layer). */
  items: SceneItem[];
}

export interface Overlay {
  id: string;
  name: string;
  text: string;
  /** How long the overlay stays on screen once triggered. */
  durationMs: number;
  /** Runtime field: epoch ms when the overlay stops being visible. */
  activeUntil: number | null;
}

export type TransitionMode = 'cut' | 'fade';

export interface ActiveTransition {
  mode: 'fade';
  fromSceneId: string;
  toSceneId: string;
  startedAt: number;
  durationMs: number;
  /** 0..1, advanced by engine.tick() */
  progress: number;
}

export interface CanvasSpec {
  width: number;
  height: number;
  fps: number;
}

export interface StudioState {
  canvas: CanvasSpec;
  sources: SourceDef[];
  scenes: Scene[];
  previewSceneId: string | null;
  programSceneId: string | null;
  overlays: Overlay[];
  transition: ActiveTransition | null;
}

/** Serialized form sent to remote controllers. */
export type StudioSnapshot = StudioState;
