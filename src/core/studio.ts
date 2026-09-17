import { Emitter } from './events';
import { clampTransform, fullFrame } from './layout';
import type { TransformPatch } from './protocol';
import type {
  CanvasSpec,
  Overlay,
  Scene,
  SceneItem,
  SourceDef,
  SourceKind,
  SourceProps,
  StudioSnapshot,
  StudioState,
  Transform,
  TransitionMode,
} from './types';
import { makeId } from './protocol';

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export const DEFAULT_CANVAS: CanvasSpec = { width: 1280, height: 720, fps: 30 };

const DEFAULT_ITEM_TRANSFORM: Transform = { x: 0, y: 0, width: 640, height: 360 };

/**
 * Pure studio model: scenes, sources, placements, preview/program,
 * transitions, overlays. No DOM, no media APIs — everything is driven by
 * method calls and `tick(now)` so it is fully testable in Node.
 */
export class StudioEngine {
  readonly changed = new Emitter<StudioState>();
  private _state: StudioState;

  constructor(state?: Partial<StudioState>) {
    this._state = {
      canvas: DEFAULT_CANVAS,
      sources: [],
      scenes: [],
      previewSceneId: null,
      programSceneId: null,
      overlays: [],
      transition: null,
      ...state,
    };
  }

  get state(): StudioState {
    return this._state;
  }

  snapshot(): StudioSnapshot {
    return structuredClone(this._state);
  }

  private emit(): void {
    // New top-level reference so useSyncExternalStore/getSnapshot subscribers
    // re-render; nested structures are intentionally shared (mutation model).
    this._state = { ...this._state };
    this.changed.emit(this._state);
  }

  // ── scenes ──────────────────────────────────────────────────────────────

  addScene(name: string): Scene {
    const scene: Scene = { id: makeId('scene'), name, items: [] };
    this._state.scenes.push(scene);
    if (!this._state.programSceneId) {
      this._state.programSceneId = scene.id;
      this._state.previewSceneId = scene.id;
    } else if (!this._state.previewSceneId) {
      this._state.previewSceneId = scene.id;
    }
    this.emit();
    return scene;
  }

  removeScene(sceneId: string): void {
    const idx = this._state.scenes.findIndex((s) => s.id === sceneId);
    if (idx < 0) throw new EngineError('not_found', `scene ${sceneId}`);
    if (this._state.scenes.length === 1) throw new EngineError('last_scene', 'cannot remove the last scene');
    this._state.scenes.splice(idx, 1);
    if (this._state.transition?.fromSceneId === sceneId || this._state.transition?.toSceneId === sceneId) {
      this._state.transition = null;
    }
    if (this._state.programSceneId === sceneId) this._state.programSceneId = this._state.scenes[0].id;
    if (this._state.previewSceneId === sceneId) this._state.previewSceneId = this._state.programSceneId;
    this.emit();
  }

  renameScene(sceneId: string, name: string): void {
    this.scene(sceneId).name = name;
    this.emit();
  }

  setPreviewScene(sceneId: string): void {
    this.scene(sceneId);
    this._state.previewSceneId = sceneId;
    this.emit();
  }

  /** Perform a transition from preview to program. */
  transition(mode: TransitionMode = 'fade', now: number = Date.now()): void {
    const preview = this._state.previewSceneId;
    const program = this._state.programSceneId;
    if (!preview) throw new EngineError('no_preview', 'no preview scene selected');
    if (preview === program) return;
    if (mode === 'cut') {
      this._state.programSceneId = preview;
      this._state.transition = null;
    } else {
      this._state.transition = {
        mode: 'fade',
        fromSceneId: program!,
        toSceneId: preview,
        startedAt: now,
        durationMs: 500,
        progress: 0,
      };
    }
    this.emit();
  }

  /** Advance transition progress and expire overlays. Called by the
   * compositor each frame; tests call it manually. */
  tick(now: number): void {
    let dirty = false;
    const t = this._state.transition;
    if (t) {
      t.progress = Math.min(1, (now - t.startedAt) / t.durationMs);
      if (t.progress >= 1) {
        this._state.programSceneId = t.toSceneId;
        this._state.transition = null;
      }
      dirty = true;
    }
    for (const ov of this._state.overlays) {
      if (ov.activeUntil !== null && now >= ov.activeUntil) {
        ov.activeUntil = null;
        dirty = true;
      }
    }
    if (dirty) this.emit();
  }

  // ── sources (global registry) ───────────────────────────────────────────

  addSource(kind: SourceKind, name: string, props: SourceProps = {}): SourceDef {
    const source: SourceDef = {
      id: makeId('src'),
      kind,
      name,
      enabled: true,
      audio: { volume: 1, muted: false },
      props,
    };
    this._state.sources.push(source);
    this.emit();
    return source;
  }

  removeSource(sourceId: string): void {
    const idx = this._state.sources.findIndex((s) => s.id === sourceId);
    if (idx < 0) throw new EngineError('not_found', `source ${sourceId}`);
    this._state.sources.splice(idx, 1);
    for (const scene of this._state.scenes) {
      scene.items = scene.items.filter((it) => it.sourceId !== sourceId);
    }
    this.emit();
  }

  renameSource(sourceId: string, name: string): void {
    this.source(sourceId).name = name;
    this.emit();
  }

  setSourceEnabled(sourceId: string, enabled: boolean): void {
    this.source(sourceId).enabled = enabled;
    this.emit();
  }

  setSourceVolume(sourceId: string, volume: number): void {
    if (!(volume >= 0 && volume <= 1)) throw new EngineError('bad_value', 'volume must be 0..1');
    this.source(sourceId).audio.volume = volume;
    this.emit();
  }

  setSourceMuted(sourceId: string, muted: boolean): void {
    this.source(sourceId).audio.muted = muted;
    this.emit();
  }

  setSourceText(sourceId: string, text: string): void {
    const s = this.source(sourceId);
    if (s.kind === 'browser') s.props.url = text;
    else s.props.text = text;
    this.emit();
  }

  setSourceProps(sourceId: string, props: SourceProps): void {
    Object.assign(this.source(sourceId).props, props);
    this.emit();
  }

  // ── scene items (placements) ────────────────────────────────────────────

  addToScene(sceneId: string, sourceId: string, transform?: Partial<Transform>): SceneItem {
    const scene = this.scene(sceneId);
    this.source(sourceId);
    if (scene.items.some((it) => it.sourceId === sourceId)) {
      throw new EngineError('duplicate', `source ${sourceId} already in scene ${sceneId}`);
    }
    const item: SceneItem = {
      id: makeId('item'),
      sourceId,
      transform: { ...DEFAULT_ITEM_TRANSFORM, ...transform },
      visible: true,
    };
    scene.items.push(item);
    this.emit();
    return item;
  }

  /** Convenience: add a source and place it full-frame in one call. */
  addSourceToScene(
    sceneId: string,
    kind: SourceKind,
    name: string,
    props: SourceProps = {},
    intrinsic?: { width: number; height: number },
  ): { source: SourceDef; item: SceneItem } {
    const source = this.addSource(kind, name, props);
    const t = intrinsic
      ? fullFrame(intrinsic.width, intrinsic.height, this._state.canvas)
      : { x: 0, y: 0, width: this._state.canvas.width, height: this._state.canvas.height };
    const item = this.addToScene(sceneId, source.id, t);
    return { source, item };
  }

  removeFromScene(sceneId: string, sourceId: string): void {
    const scene = this.scene(sceneId);
    const idx = scene.items.findIndex((it) => it.sourceId === sourceId);
    if (idx < 0) throw new EngineError('not_found', `source ${sourceId} not in scene ${sceneId}`);
    scene.items.splice(idx, 1);
    this.emit();
  }

  setItemVisible(sceneId: string, sourceId: string, visible: boolean): void {
    this.item(sceneId, sourceId).visible = visible;
    this.emit();
  }

  setItemTransform(sceneId: string, sourceId: string, transform: Transform): void {
    this.item(sceneId, sourceId).transform = clampTransform(transform, this._state.canvas);
    this.emit();
  }

  patchItemTransform(sceneId: string, sourceId: string, patch: TransformPatch): void {
    const it = this.item(sceneId, sourceId);
    it.transform = clampTransform({ ...it.transform, ...patch }, this._state.canvas);
    this.emit();
  }

  /** Raise/lower an item in the z-order. dir=+1 draws later (on top). */
  moveItem(sceneId: string, sourceId: string, dir: 1 | -1): void {
    const scene = this.scene(sceneId);
    const idx = scene.items.findIndex((it) => it.sourceId === sourceId);
    if (idx < 0) throw new EngineError('not_found', `source ${sourceId} not in scene ${sceneId}`);
    const to = idx + dir;
    if (to < 0 || to >= scene.items.length) return;
    const [it] = scene.items.splice(idx, 1);
    scene.items.splice(to, 0, it);
    this.emit();
  }

  // ── overlays ────────────────────────────────────────────────────────────

  addOverlay(name: string, text: string, durationMs = 5000): Overlay {
    const overlay: Overlay = { id: makeId('ov'), name, text, durationMs, activeUntil: null };
    this._state.overlays.push(overlay);
    this.emit();
    return overlay;
  }

  removeOverlay(overlayId: string): void {
    const idx = this._state.overlays.findIndex((o) => o.id === overlayId);
    if (idx < 0) throw new EngineError('not_found', `overlay ${overlayId}`);
    this._state.overlays.splice(idx, 1);
    this.emit();
  }

  triggerOverlay(overlayId: string, now: number): void {
    const ov = this._state.overlays.find((o) => o.id === overlayId);
    if (!ov) throw new EngineError('not_found', `overlay ${overlayId}`);
    ov.activeUntil = now + ov.durationMs;
    this.emit();
  }

  // ── lookups ─────────────────────────────────────────────────────────────

  scene(sceneId: string): Scene {
    const s = this._state.scenes.find((sc) => sc.id === sceneId);
    if (!s) throw new EngineError('not_found', `scene ${sceneId}`);
    return s;
  }

  source(sourceId: string): SourceDef {
    const s = this._state.sources.find((sc) => sc.id === sourceId);
    if (!s) throw new EngineError('not_found', `source ${sourceId}`);
    return s;
  }

  item(sceneId: string, sourceId: string): SceneItem {
    const it = this.scene(sceneId).items.find((i) => i.sourceId === sourceId);
    if (!it) throw new EngineError('not_found', `source ${sourceId} not in scene ${sceneId}`);
    return it;
  }

  sceneByName(name: string): Scene | undefined {
    const n = name.toLowerCase();
    return this._state.scenes.find((s) => s.name.toLowerCase() === n);
  }

  sourceByName(name: string): SourceDef | undefined {
    const n = name.toLowerCase();
    return this._state.sources.find((s) => s.name.toLowerCase() === n);
  }

  overlayByName(name: string): Overlay | undefined {
    const n = name.toLowerCase();
    return this._state.overlays.find((o) => o.name.toLowerCase() === n);
  }
}
