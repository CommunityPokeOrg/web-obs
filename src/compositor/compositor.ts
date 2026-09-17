import type { StudioEngine } from '../core/studio';
import type { Scene, SceneItem, SourceDef } from '../core/types';

/** Minimal 2D context surface the compositor uses — real
 * CanvasRenderingContext2D satisfies it, and tests can stub it. */
export interface Draw2D {
  canvas: { width: number; height: number };
  fillStyle: unknown;
  strokeStyle: unknown;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  save(): void;
  restore(): void;
}

/** Supplies drawable pixels (video elements, ImageBitmaps, canvases) for
 * media-backed sources. Non-media kinds (text/color/browser) return null
 * and the compositor renders them directly. */
export interface DrawableProvider {
  getDrawable(sourceId: string): CanvasImageSource | null;
}

export class Compositor {
  private raf = 0;
  private running = false;

  constructor(
    private engine: StudioEngine,
    private provider: DrawableProvider,
    private ctx: Draw2D,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      this.engine.tick(now);
      this.drawFrame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Render one frame. `now` is the frame timestamp used for overlays. */
  drawFrame(now: number): void {
    const { ctx, engine } = this;
    const { canvas } = engine.state;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const t = engine.state.transition;
    const programId = t ? t.fromSceneId : engine.state.programSceneId;
    const program = engine.state.scenes.find((s) => s.id === programId);
    if (program) this.drawScene(program, 1);
    if (t) {
      const to = engine.state.scenes.find((s) => s.id === t.toSceneId);
      if (to) this.drawScene(to, t.progress);
    }

    this.drawOverlays(now);
    ctx.restore();
  }

  private drawScene(scene: Scene, alpha: number): void {
    const { ctx } = this;
    for (const item of scene.items) {
      if (!item.visible) continue;
      let source: SourceDef;
      try {
        source = this.engine.source(item.sourceId);
      } catch {
        continue;
      }
      if (!source.enabled) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      this.drawItem(item, source);
      ctx.restore();
    }
  }

  private drawItem(item: SceneItem, source: SourceDef): void {
    const { ctx } = this;
    const { x, y, width: w, height: h } = item.transform;
    switch (source.kind) {
      case 'color':
        ctx.fillStyle = source.props.fill ?? '#202020';
        ctx.fillRect(x, y, w, h);
        return;
      case 'text':
        this.drawText(source, x, y, w, h);
        return;
      case 'browser':
        this.drawPlaceholder(x, y, w, h, source, `browser source: ${source.props.url ?? 'unset'}`);
        return;
      case 'remote': {
        const frame = this.provider.getDrawable(source.id);
        if (frame) {
          ctx.drawImage(frame, x, y, w, h);
        } else {
          this.drawPlaceholder(x, y, w, h, source, 'remote feed — waiting for frames');
        }
        return;
      }
      default: {
        const drawable = this.provider.getDrawable(source.id);
        if (drawable) {
          try {
            ctx.drawImage(drawable, x, y, w, h);
            return;
          } catch {
            // fall through to placeholder on a bad drawable
          }
        }
        this.drawPlaceholder(x, y, w, h, source, 'no signal');
      }
    }
  }

  private drawText(source: SourceDef, x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    const text = source.props.text ?? '';
    const size = source.props.fontSize ?? 32;
    if (source.props.background) {
      ctx.fillStyle = source.props.background;
      ctx.fillRect(x, y, w, h);
    }
    ctx.font = `${size}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const align = source.props.align ?? 'center';
    ctx.textAlign = align;
    ctx.fillStyle = source.props.color ?? '#ffffff';
    const tx = align === 'left' ? x + 8 : align === 'right' ? x + w - 8 : x + w / 2;
    ctx.fillText(text, tx, y + h / 2);
  }

  private drawPlaceholder(x: number, y: number, w: number, h: number, source: SourceDef, caption: string): void {
    const { ctx } = this;
    ctx.fillStyle = '#16181d';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#3a3f4a';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.font = '16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8a93a5';
    ctx.fillText(`${source.name}`, x + w / 2, y + h / 2 - 12);
    ctx.fillStyle = '#5a6274';
    ctx.fillText(caption, x + w / 2, y + h / 2 + 12);
  }

  private drawOverlays(now: number): void {
    const { ctx, engine } = this;
    const { width, height } = engine.state.canvas;
    for (const ov of engine.state.overlays) {
      if (ov.activeUntil === null || now >= ov.activeUntil) continue;
      const remaining = ov.activeUntil - now;
      const fade = Math.min(1, remaining / 300); // fade out over last 300ms
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.font = '28px system-ui, sans-serif';
      const tw = ctx.measureText(ov.text).width;
      const bw = tw + 80;
      const bh = 64;
      const bx = (width - bw) / 2;
      const by = height - bh - 60;
      ctx.fillStyle = 'rgba(12, 14, 18, 0.92)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#7c5cff';
      ctx.fillRect(bx, by, 6, bh);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ov.text, width / 2, by + bh / 2);
      ctx.restore();
    }
  }
}
