import type { DrawableProvider } from '../compositor/compositor';
import type { SourceDef } from '../core/types';
import { AudioMixer } from './mixer';
import { RemoteFeedReceiver, type RemoteFeedConfig } from './remote-feed';

interface Binding {
  video?: HTMLVideoElement;
  image?: HTMLImageElement;
  stream?: MediaStream;
  objectUrl?: string;
  receiver?: RemoteFeedReceiver;
}

export type RemoteFeedConfigFactory = (feedId: string) => RemoteFeedConfig;

/**
 * Owns the real browser objects behind media-backed sources: getUserMedia /
 * getDisplayMedia streams, <video>/<img> elements, remote feed receivers —
 * and wires their audio into the mixer. Pure-model kinds (text/color) and
 * browser sources (rendered as DOM overlays) attach as no-ops.
 */
export class MediaSourceManager implements DrawableProvider {
  private bindings = new Map<string, Binding>();

  constructor(
    private mixer: AudioMixer,
    private remoteCfg: RemoteFeedConfigFactory | null = null,
  ) {}

  /**
   * Acquire/attach whatever the source kind needs. For capture kinds this
   * triggers the browser permission prompt — call from a user gesture.
   * `file` is required for media/image sources.
   */
  async attach(source: SourceDef, file?: File): Promise<void> {
    this.detach(source.id);
    switch (source.kind) {
      case 'webcam': {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        const video = this.videoFor(stream);
        this.mixer.attachStream(source.id, stream);
        this.bindings.set(source.id, { video, stream });
        return;
      }
      case 'screen': {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const video = this.videoFor(stream);
        this.mixer.attachStream(source.id, stream);
        this.bindings.set(source.id, { video, stream });
        return;
      }
      case 'media': {
        if (!file) throw new Error('media source needs a file');
        const objectUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.src = objectUrl;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => undefined);
        this.mixer.attachElement(source.id, video);
        this.bindings.set(source.id, { video, objectUrl });
        return;
      }
      case 'image': {
        if (!file) throw new Error('image source needs a file');
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        this.bindings.set(source.id, { image, objectUrl });
        return;
      }
      case 'remote': {
        if (!this.remoteCfg || !source.props.feedId) {
          throw new Error('remote source needs a feedId and a configured relay URL');
        }
        const receiver = new RemoteFeedReceiver(this.remoteCfg(source.props.feedId));
        receiver.connect();
        this.bindings.set(source.id, { receiver });
        return;
      }
      case 'text':
      case 'color':
      case 'browser':
        this.bindings.set(source.id, {});
        return;
    }
  }

  private videoFor(stream: MediaStream): HTMLVideoElement {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => undefined);
    return video;
  }

  detach(sourceId: string): void {
    const b = this.bindings.get(sourceId);
    if (!b) return;
    b.stream?.getTracks().forEach((t) => t.stop());
    b.video?.pause();
    if (b.video) b.video.srcObject = null;
    if (b.objectUrl) URL.revokeObjectURL(b.objectUrl);
    b.receiver?.close();
    this.mixer.detach(sourceId);
    this.bindings.delete(sourceId);
  }

  detachAll(): void {
    for (const id of [...this.bindings.keys()]) this.detach(id);
  }

  getDrawable(sourceId: string): CanvasImageSource | null {
    const b = this.bindings.get(sourceId);
    if (!b) return null;
    if (b.receiver) return b.receiver.getDrawable();
    const el = b.video ?? b.image ?? null;
    if (el instanceof HTMLVideoElement && el.readyState < 2) return null;
    return el;
  }

  intrinsicSize(sourceId: string): { width: number; height: number } | null {
    const b = this.bindings.get(sourceId);
    const el = b?.video ?? b?.image;
    if (!el) return null;
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    return w && h ? { width: w, height: h } : null;
  }

  status(sourceId: string): string {
    return this.bindings.has(sourceId) ? 'attached' : 'detached';
  }
}
